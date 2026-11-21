param(
  [Parameter(Mandatory = $true)][string]$PayloadBase64,
  # Exercises the "open" action without a pointer; never passed by the Host.
  [switch]$SelfTest,
  # Prints the window the "open" action would raise and exits; diagnostics only.
  [switch]$DryRun
)

# Always-on-top notification card for Windows.
#
# Runs as its own short-lived process so the card can float above every other
# application, which the in-app web overlay cannot do. One JSON payload (base64
# UTF-8) carries the localized text, the theme palette and the geometry.
#
# Exit codes: 0 closed or timed out, 2 the card could not be built, 10 the
# person pressed "open" (the card then raises the Harness window and the caller
# opens the chat).

$ErrorActionPreference = 'Stop'
$script:result = 0
$script:openRequested = $false

function Get-Brush([string]$value, [string]$fallback) {
  try {
    $converter = New-Object System.Windows.Media.BrushConverter
    return $converter.ConvertFromString($value)
  } catch {
    $converter = New-Object System.Windows.Media.BrushConverter
    return $converter.ConvertFromString($fallback)
  }
}

try {
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json
  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml
} catch {
  exit 2
}

# Тему берём из payload уже после разбора JSON: у светлой и тёмной палитры
# разные цвета, и молчаливый откат к тёмной был бы неверным.
$backgroundText = [string]$json.background
if ([string]::IsNullOrWhiteSpace($backgroundText)) { $backgroundText = '#F21E1F24' }
$foregroundText = [string]$json.foreground
if ([string]::IsNullOrWhiteSpace($foregroundText)) { $foregroundText = '#F2F4F7' }
$mutedText = [string]$json.muted
if ([string]::IsNullOrWhiteSpace($mutedText)) { $mutedText = '#A4AAB3' }
$accentText = [string]$json.accent
if ([string]::IsNullOrWhiteSpace($accentText)) { $accentText = '#38C98A' }

$script:windowApi = $false
try {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DshNotifyNative {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PROCESSENTRY32W {
    public uint dwSize;
    public uint cntUsage;
    public uint th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID;
    public uint cntThreads;
    public uint th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcRow {
    public uint Pid;
    public uint ParentPid;
    public string Name;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct WinRow {
    public IntPtr Hwnd;
    public IntPtr Owner;
    public uint Pid;
    public bool Visible;
    public bool Iconic;
    public string ClassName;
    public string Title;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr hObject);

  [DllImport("user32.dll")]
  static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")]
  static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")]
  static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("kernel32.dll")]
  static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

  /** Every process with its parent, so the app process is found by name. */
  public static ProcRow[] Processes() {
    List<ProcRow> rows = new List<ProcRow>();
    IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
    if (snapshot == new IntPtr(-1)) return rows.ToArray();
    try {
      PROCESSENTRY32W entry = new PROCESSENTRY32W();
      entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
      bool ok = Process32FirstW(snapshot, ref entry);
      while (ok) {
        ProcRow row = new ProcRow();
        row.Pid = entry.th32ProcessID;
        row.ParentPid = entry.th32ParentProcessID;
        row.Name = entry.szExeFile;
        rows.Add(row);
        ok = Process32NextW(snapshot, ref entry);
      }
    } finally {
      CloseHandle(snapshot);
    }
    return rows.ToArray();
  }

  /** Every top-level window, visible, minimized or hidden alike. */
  public static WinRow[] Windows() {
    List<WinRow> rows = new List<WinRow>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      WinRow row = new WinRow();
      row.Hwnd = hWnd;
      row.Owner = GetWindow(hWnd, 4);
      uint pid = 0;
      GetWindowThreadProcessId(hWnd, out pid);
      row.Pid = pid;
      row.Visible = IsWindowVisible(hWnd);
      row.Iconic = IsIconic(hWnd);
      StringBuilder title = new StringBuilder(GetWindowTextLength(hWnd) + 2);
      GetWindowText(hWnd, title, title.Capacity);
      row.Title = title.ToString();
      StringBuilder className = new StringBuilder(256);
      GetClassName(hWnd, className, className.Capacity);
      row.ClassName = className.ToString();
      rows.Add(row);
      return true;
    }, IntPtr.Zero);
    return rows.ToArray();
  }

  /** Restore, show and foreground one window, defeating the foreground lock. */
  public static bool Focus(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    if (IsIconic(hWnd)) ShowWindow(hWnd, 9);
    else ShowWindow(hWnd, 5);
    // Raise above ordinary windows first: even when Windows refuses activation,
    // the window still becomes visible instead of leaving the last app in front.
    SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040);
    IntPtr foreground = GetForegroundWindow();
    uint foregroundPid = 0;
    uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out foregroundPid);
    uint selfThread = GetCurrentThreadId();
    bool attached = false;
    if (foregroundThread != 0 && foregroundThread != selfThread) {
      attached = AttachThreadInput(selfThread, foregroundThread, true);
    }
    try {
      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);
      if (GetForegroundWindow() != hWnd) SwitchToThisWindow(hWnd, true);
    } finally {
      if (attached) AttachThreadInput(selfThread, foregroundThread, false);
    }
    SetWindowPos(hWnd, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
    // A window the person can see is a success even if activation was refused.
    return GetForegroundWindow() == hWnd || IsWindowVisible(hWnd);
  }
}
"@
  $script:windowApi = $true
} catch {
  # Raising the app window is best effort; the card itself still works.
}

$actionFile = ''
if (-not [string]::IsNullOrWhiteSpace([string]$json.actionFile)) { $actionFile = [string]$json.actionFile }

$width = 384
if ($null -ne $json.width -and [double]$json.width -ge 260 -and [double]$json.width -le 560) {
  $width = [double]$json.width
}

$corner = 'top-right'
if ($json.corner -in @('top-right', 'top-left', 'bottom-right', 'bottom-left')) { $corner = [string]$json.corner }
$offset = 0
if ($null -ne $json.offset) { $offset = [int]$json.offset }
$durationMs = 6000
if ($null -ne $json.durationMs) { $durationMs = [int]$json.durationMs }
$openLabel = 'Open'
if (-not [string]::IsNullOrWhiteSpace([string]$json.openLabel)) { $openLabel = [string]$json.openLabel }
$dismissLabel = 'Close'
if (-not [string]::IsNullOrWhiteSpace([string]$json.dismissLabel)) { $dismissLabel = [string]$json.dismissLabel }
# The page's own title, used only when Harness itself is not running (the
# person works in a browser tab) to find that exact browser window.
$windowTitle = ''
if (-not [string]::IsNullOrWhiteSpace([string]$json.windowTitle)) { $windowTitle = ([string]$json.windowTitle).Trim() }

$fontFamilyName = 'Segoe UI'
if (-not [string]::IsNullOrWhiteSpace([string]$json.fontFamily)) { $fontFamilyName = [string]$json.fontFamily }
$bodySize = 13.0
if ($null -ne $json.bodySize) { $bodySize = [double]$json.bodySize }
$titleSize = $bodySize * 1.08
if ($null -ne $json.titleSize) { $titleSize = [double]$json.titleSize }
$metaSize = $bodySize * 0.86
if ($null -ne $json.metaSize) { $metaSize = [double]$json.metaSize }
$weightValue = [System.Windows.FontWeights]::Normal
if ([string]$json.weight -eq '600') { $weightValue = [System.Windows.FontWeights]::SemiBold }
$styleValue = [System.Windows.FontStyles]::Normal
if ($json.italic -eq $true) { $styleValue = [System.Windows.FontStyles]::Italic }

# --- window targeting -------------------------------------------------------
# "Open" must raise the Harness window itself. Matching processes by a window
# title used to pull a browser tab or an Explorer folder titled "DeepSeek
# Harness" to the front instead, so the app is identified by its executable;
# only when Harness is not running at all is the page's browser window matched,
# and then by its exact title.

$script:appPattern = '(?i)^deepseek[\s_-]*harness[^\\]*\.exe$'

function Get-AppPids {
  if (-not $script:windowApi) { return @() }
  $pids = @()
  try {
    foreach ($row in [DshNotifyNative]::Processes()) {
      if ([string]$row.Name -match $script:appPattern) { $pids += [int]$row.Pid }
    }
  } catch {
    return @()
  }
  return $pids
}

function Get-WindowRows {
  if (-not $script:windowApi) { return @() }
  try {
    return @([DshNotifyNative]::Windows())
  } catch {
    return @()
  }
}

# A real application window: the framed Chromium widget, or any visible unowned
# window. Chromium's hidden helper widget is deliberately never a candidate.
function Test-AppWindow($row) {
  if ($null -eq $row) { return $false }
  if (([IntPtr]$row.Owner) -ne [IntPtr]::Zero) { return $false }
  if ([string]$row.ClassName -eq 'Chrome_WidgetWin_1') { return $true }
  return ($row.Visible -eq $true -and [string]$row.Title -ne '')
}

function Select-AppWindow([object[]]$windows, [int[]]$pids) {
  $candidates = @($windows | Where-Object { ($pids -contains [int]$_.Pid) -and (Test-AppWindow $_) })
  if ($candidates.Count -eq 0) { return $null }
  # The Chromium frame is the application's real window; any other window of
  # the same process is only a last resort.
  $pool = @($candidates | Where-Object { [string]$_.ClassName -eq 'Chrome_WidgetWin_1' })
  if ($pool.Count -eq 0) { $pool = $candidates }
  $best = $pool | Where-Object { $_.Visible -eq $true -and $_.Iconic -eq $false } | Select-Object -First 1
  if ($null -eq $best) { $best = $pool | Where-Object { $_.Visible -eq $true } | Select-Object -First 1 }
  if ($null -eq $best) { $best = $pool[0] }
  return $best
}

# Browser mode: only a browser window whose title is this page's title counts.
# Chrome appends " - Google Chrome" to some titles, so a suffix is allowed; an
# unrelated Explorer folder or another app is never a candidate.
function Select-BrowserWindow([object[]]$windows) {
  if ($windowTitle -eq '') { return $null }
  $browserClasses = @('Chrome_WidgetWin_1', 'MozillaWindowClass')
  $candidates = @($windows | Where-Object {
    if ($_.Visible -ne $true) { return $false }
    if (([IntPtr]$_.Owner) -ne [IntPtr]::Zero) { return $false }
    if ($browserClasses -notcontains [string]$_.ClassName) { return $false }
    $title = ([string]$_.Title).Trim()
    if ($title -ieq $windowTitle) { return $true }
    return $title.StartsWith("$windowTitle - ", [System.StringComparison]::OrdinalIgnoreCase)
  })
  if ($candidates.Count -eq 0) { return $null }
  $best = $candidates | Where-Object { $_.Iconic -eq $false } | Select-Object -First 1
  if ($null -eq $best) { $best = $candidates[0] }
  return $best
}

function Get-OpenPlan {
  $windows = @(Get-WindowRows)
  $pids = @(Get-AppPids)
  $mode = 'none'
  $action = 'none'
  $hwnd = [IntPtr]::Zero
  if ($pids.Count -gt 0) {
    $mode = 'app'
    $target = Select-AppWindow $windows $pids
    if ($null -eq $target) {
      $action = 'app-open'
    } else {
      $hwnd = [IntPtr]$target.Hwnd
      if ($target.Visible -eq $true) { $action = 'focus' } else { $action = 'focus-or-open' }
    }
  } else {
    $target = Select-BrowserWindow $windows
    if ($null -ne $target) {
      $mode = 'browser'
      $action = 'focus'
      $hwnd = [IntPtr]$target.Hwnd
    }
  }
  return [pscustomobject]@{
    mode = $mode
    action = $action
    hwnd = $hwnd.ToInt64()
    appPids = @($pids)
    title = $windowTitle
  }
}

# Let the application raise itself through its own single-instance path, which
# restores a window hidden to the tray and creates one after an unclean exit.
# The executable of the running app is preferred: it needs no protocol handler
# and cannot pop a Windows "how do you want to open this" picker.
function Start-AppOpen {
  # The Host runs as Electron in Node mode, so its environment carries
  # ELECTRON_RUN_AS_NODE=1. Inherited by Start-Process it would start the app as
  # a headless Node process instead of the GUI, so it is removed for this launch.
  $runAsNode = $env:ELECTRON_RUN_AS_NODE
  try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    foreach ($processId in @(Get-AppPids)) {
      try {
        $exe = (Get-Process -Id $processId -ErrorAction Stop).Path
        if (-not [string]::IsNullOrWhiteSpace($exe) -and (Test-Path -LiteralPath $exe)) {
          Start-Process -FilePath $exe -ErrorAction Stop
          return $true
        }
      } catch {
        # One unreadable process must not stop the next.
      }
    }
    if (-not (Test-DshProtocol)) { return $false }
    try {
      Start-Process -FilePath 'dsh://open' -ErrorAction Stop
      return $true
    } catch {
      return $false
    }
  } finally {
    if ($null -ne $runAsNode) { $env:ELECTRON_RUN_AS_NODE = $runAsNode }
  }
}

# Start-AppOpen falls back to `dsh://open` only when the packaged application
# actually registered the protocol, so a missing handler never opens the Windows
# "how do you want to open this" picker.
function Test-DshProtocol {
  foreach ($key in @('HKCU:\Software\Classes\dsh\shell\open\command', 'HKCR:\dsh\shell\open\command')) {
    try {
      if (-not (Test-Path $key)) { continue }
      $command = [string](Get-ItemProperty -Path $key -ErrorAction Stop).'(default)'
      if ([string]::IsNullOrWhiteSpace($command)) { continue }
      if ($command -match '^\s*"([^"]+)"') { return (Test-Path -LiteralPath $Matches[1]) }
      $first = ($command -split '\s+', 2)[0]
      return (Test-Path -LiteralPath $first)
    } catch {
      # Try the next registration.
    }
  }
  return $false
}

# Append one line to the update/open diagnostic log, never failing the card.
function Write-OpenLog([string]$text) {
  try {
    $dir = Join-Path $env:TEMP 'dsh-notify'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Add-Content -LiteralPath (Join-Path $dir 'open.log') -Value ('{0:yyyy-MM-dd HH:mm:ss.fff} {1}' -f (Get-Date), $text) -Encoding UTF8
  } catch {
  }
}

function Show-TargetWindow {
  $plan = Get-OpenPlan
  if ($plan.mode -eq 'app') {
    if ($plan.hwnd -ne 0 -and $script:windowApi) {
      $focused = [DshNotifyNative]::Focus([IntPtr]$plan.hwnd)
      if ($focused) { return }
      Write-OpenLog ('focus failed hwnd={0}' -f $plan.hwnd)
    }
    $launched = Start-AppOpen
    Write-OpenLog ('launch ok={0}' -f $launched)
    if (-not $launched) { return }
    # The application was asked to show itself; give it a moment, then make sure
    # the restored window really is in front.
    $deadline = [DateTime]::UtcNow.AddMilliseconds(5000)
    do {
      Start-Sleep -Milliseconds 120
      $target = Select-AppWindow (Get-WindowRows) @(Get-AppPids)
      if ($null -ne $target -and $target.Visible -eq $true) {
        [void][DshNotifyNative]::Focus([IntPtr]$target.Hwnd)
        return
      }
    } while ([DateTime]::UtcNow -lt $deadline)
    Write-OpenLog 'timeout waiting for an app window'
    return
  }
  if ($plan.mode -eq 'browser' -and $plan.hwnd -ne 0 -and $script:windowApi) {
    [void][DshNotifyNative]::Focus([IntPtr]$plan.hwnd)
  }
}

if ($DryRun) {
  $plan = Get-OpenPlan
  [Console]::Out.WriteLine(($plan | ConvertTo-Json -Compress))
  exit 0
}

function Blend([string]$foreground, [string]$background, [double]$amount) {
  try {
    $fg = ($foreground -replace '^#(?:[0-9A-Fa-f]{2})?', '#').Substring(1)
    $bg = ($background -replace '^#(?:[0-9A-Fa-f]{2})?', '#').Substring(1)
    $r = [Math]::Round([Convert]::ToInt32($fg.Substring(0, 2), 16) * $amount + [Convert]::ToInt32($bg.Substring(0, 2), 16) * (1 - $amount))
    $g = [Math]::Round([Convert]::ToInt32($fg.Substring(2, 2), 16) * $amount + [Convert]::ToInt32($bg.Substring(2, 2), 16) * (1 - $amount))
    $b = [Math]::Round([Convert]::ToInt32($fg.Substring(4, 2), 16) * $amount + [Convert]::ToInt32($bg.Substring(4, 2), 16) * (1 - $amount))
    return ('#{0:X2}{1:X2}{2:X2}' -f [Math]::Min(255, $r), [Math]::Min(255, $g), [Math]::Min(255, $b))
  } catch {
    return $background
  }
}

$bgBrush = Get-Brush $backgroundText '#F21E1F24'
$fgBrush = Get-Brush $foregroundText '#FFF2F3F5'
$mutedBrush = Get-Brush $mutedText '#FF9AA0A6'
$accentBrush = Get-Brush $accentText '#FF38C98A'
$borderBrush = Get-Brush ([string]$json.border) '#33FFFFFF'

# A readable label on the accent button: dark text on a light accent.
$accentHex = ([string]$json.accent) -replace '^#(?:[0-9A-Fa-f]{2})?', '#'
$openForeground = '#FFFFFFFF'
try {
  $r = [Convert]::ToInt32($accentHex.Substring(1, 2), 16)
  $g = [Convert]::ToInt32($accentHex.Substring(3, 2), 16)
  $b = [Convert]::ToInt32($accentHex.Substring(5, 2), 16)
  if ((0.299 * $r + 0.587 * $g + 0.114 * $b) -gt 168) { $openForeground = '#FF101114' }
} catch {
}

$script:window = New-Object System.Windows.Window
$script:window.WindowStyle = [System.Windows.WindowStyle]::None
$script:window.AllowsTransparency = $true
$script:window.Background = [System.Windows.Media.Brushes]::Transparent
$script:window.Topmost = $true
$script:window.ShowInTaskbar = $false
$script:window.ShowActivated = $false
$script:window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$script:window.SizeToContent = [System.Windows.SizeToContent]::Height
$script:window.Width = $width
$script:window.FontFamily = New-Object System.Windows.Media.FontFamily $fontFamilyName

$root = New-Object System.Windows.Controls.Border
$root.CornerRadius = New-Object System.Windows.CornerRadius 16
# Фон — градиент от цвета типа уведомления к тёмной основе DSH.
$gradientStart = Get-Brush (Blend $accentText $backgroundText 0.34) $backgroundText
$gradientEnd = Get-Brush (Blend $accentText $backgroundText 0.04) $backgroundText
$gradientBrush = New-Object System.Windows.Media.LinearGradientBrush
$gradientBrush.StartPoint = New-Object System.Windows.Point 0, 0
$gradientBrush.EndPoint = New-Object System.Windows.Point 1, 1
$gradientBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop $gradientStart.Color, 0))
$gradientBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop $gradientEnd.Color, 1))
$root.Background = $gradientBrush
$root.BorderBrush = $borderBrush
$root.BorderThickness = New-Object System.Windows.Thickness 1
$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$shadow.BlurRadius = 22
$shadow.ShadowDepth = 0
$shadow.Opacity = 0.38
$shadow.Color = [System.Windows.Media.Color]::FromArgb(255, 0, 0, 0)
$root.Effect = $shadow
$script:window.Content = $root

$body = New-Object System.Windows.Controls.StackPanel
$body.Margin = New-Object System.Windows.Thickness 16, 13, 14, 12
$root.Child = $body

# Заголовок: иконка типа, два текста и кнопка закрытия — как во внутренних плашках.
$header = New-Object System.Windows.Controls.Grid
$iconColumn = New-Object System.Windows.Controls.ColumnDefinition
$iconColumn.Width = New-Object System.Windows.GridLength 0, ([System.Windows.GridUnitType]::Auto)
$textColumn = New-Object System.Windows.Controls.ColumnDefinition
$textColumn.Width = New-Object System.Windows.GridLength 1, ([System.Windows.GridUnitType]::Star)
$closeColumn = New-Object System.Windows.Controls.ColumnDefinition
$closeColumn.Width = New-Object System.Windows.GridLength 0, ([System.Windows.GridUnitType]::Auto)
$header.ColumnDefinitions.Add($iconColumn)
$header.ColumnDefinitions.Add($textColumn)
$header.ColumnDefinitions.Add($closeColumn)
$null = $body.Children.Add($header)

$iconCircle = New-Object System.Windows.Controls.Border
$iconCircle.Width = 32
$iconCircle.Height = 32
$iconCircle.CornerRadius = New-Object System.Windows.CornerRadius 16
$iconBg = Blend $accentText $backgroundText 0.16
$iconCircle.Background = Get-Brush $iconBg $iconBg
$iconCircle.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
$iconCircle.Margin = New-Object System.Windows.Thickness 0, 1, 11, 0
[System.Windows.Controls.Grid]::SetColumn($iconCircle, 0)
$null = $header.Children.Add($iconCircle)

$iconGlyph = New-Object System.Windows.Controls.TextBlock
# Тип уведомления: из payload, иначе по цвету акцента (зелёный/оранжевый/красный).
$notifyKind = [string]$json.kind
if ([string]::IsNullOrWhiteSpace($notifyKind)) {
  try {
    $accentPlain = ($accentText -replace "^#(?:[0-9A-Fa-f]{2})?", "#").Substring(1)
    $accentR = [Convert]::ToInt32($accentPlain.Substring(0, 2), 16)
    $accentG = [Convert]::ToInt32($accentPlain.Substring(2, 2), 16)
    $accentB = [Convert]::ToInt32($accentPlain.Substring(4, 2), 16)
    if ($accentG -ge $accentR) { $notifyKind = "done" }
    elseif (($accentG / [Math]::Max(1, $accentB)) -lt 1.4) { $notifyKind = "error" }
    else { $notifyKind = "attention" }
  } catch { $notifyKind = "done" }
}
$glyphText = [string][char]0x2713
if ($notifyKind -eq "attention") { $glyphText = "!" }
if ($notifyKind -eq "error") { $glyphText = [string][char]0x2715 }
$iconGlyph.Text = $glyphText
$iconGlyph.FontSize = 15
$iconGlyph.FontWeight = [System.Windows.FontWeights]::Bold
$iconGlyph.Foreground = $accentBrush
$iconGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$iconGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$iconCircle.Child = $iconGlyph

$heading = New-Object System.Windows.Controls.StackPanel
[System.Windows.Controls.Grid]::SetColumn($heading, 1)
$heading.Margin = New-Object System.Windows.Thickness 0, 0, 8, 0
$null = $header.Children.Add($heading)

$title = New-Object System.Windows.Controls.TextBlock
$title.Text = [string]$json.title
$title.FontSize = $titleSize
$title.FontWeight = [System.Windows.FontWeights]::SemiBold
$title.Foreground = $fgBrush
$title.TextWrapping = [System.Windows.TextWrapping]::Wrap
$title.FontStyle = $styleValue
$null = $heading.Children.Add($title)

$subtitleText = [string]$json.subtitle
if ([string]::IsNullOrWhiteSpace($subtitleText)) { $subtitleText = [string]$json.meta }
if (-not [string]::IsNullOrWhiteSpace($subtitleText)) {
  $subtitle = New-Object System.Windows.Controls.TextBlock
  $subtitle.Text = $subtitleText
  $subtitle.Margin = New-Object System.Windows.Thickness 0, 2, 0, 0
  $subtitle.FontSize = $metaSize
  $subtitle.Foreground = $mutedBrush
  $subtitle.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $subtitle.FontStyle = $styleValue
  $null = $heading.Children.Add($subtitle)
}

$close = New-Object System.Windows.Controls.Border
$close.Width = 30
$close.Height = 30
$close.CornerRadius = New-Object System.Windows.CornerRadius 15
$closeBg = Blend $foregroundText $backgroundText 0.07
$close.Background = Get-Brush $closeBg $closeBg
$close.Cursor = [System.Windows.Input.Cursors]::Hand
$close.ToolTip = $dismissLabel
$close.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
[System.Windows.Controls.Grid]::SetColumn($close, 2)
$null = $header.Children.Add($close)

$closeGlyph = New-Object System.Windows.Controls.TextBlock
$closeGlyph.Text = [string][char]0x2715
$closeGlyph.FontSize = 15
$closeGlyph.FontWeight = [System.Windows.FontWeights]::Normal
$closeGlyph.Foreground = $mutedBrush
$closeGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$closeGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$closeGlyph.Margin = New-Object System.Windows.Thickness 0, -1, 0, 0
$close.Child = $closeGlyph

$close.Add_MouseEnter({
  $closeHoverBg = Blend $foregroundText $backgroundText 0.16
  $close.Background = Get-Brush $closeHoverBg $closeHoverBg
  $closeGlyph.Foreground = $fgBrush
})
$close.Add_MouseLeave({
  $close.Background = Get-Brush $closeBg $closeBg
  $closeGlyph.Foreground = $mutedBrush
})
$close.Add_MouseLeftButtonUp({
  $script:result = 0
  $script:window.Close()
})

$bodyText = New-Object System.Windows.Controls.TextBlock
$bodyText.Text = [string]$json.body
$bodyText.Margin = New-Object System.Windows.Thickness 0, 9, 0, 0
$bodyText.FontSize = $bodySize
$bodyText.Foreground = $fgBrush
$bodyText.TextWrapping = [System.Windows.TextWrapping]::Wrap
$bodyText.FontWeight = $weightValue
$bodyText.FontStyle = $styleValue
$null = $body.Children.Add($bodyText)

# Нижняя строка: кнопки и время, как на внутренних плашках.
$footer = New-Object System.Windows.Controls.Grid
$footer.Margin = New-Object System.Windows.Thickness 0, 12, 0, 0
$footerLeft = New-Object System.Windows.Controls.StackPanel
$footerLeft.Orientation = [System.Windows.Controls.Orientation]::Horizontal
$footerLeftColumn = New-Object System.Windows.Controls.ColumnDefinition
$footerLeftColumn.Width = New-Object System.Windows.GridLength 1, ([System.Windows.GridUnitType]::Star)
$footerTimeColumn = New-Object System.Windows.Controls.ColumnDefinition
$footerTimeColumn.Width = New-Object System.Windows.GridLength 0, ([System.Windows.GridUnitType]::Auto)
$footer.ColumnDefinitions.Add($footerLeftColumn)
$footer.ColumnDefinitions.Add($footerTimeColumn)
$null = $footer.Children.Add($footerLeft)
$null = $body.Children.Add($footer)

$open = New-Object System.Windows.Controls.Border
$open.CornerRadius = New-Object System.Windows.CornerRadius 9
$openBg = Blend $accentText $backgroundText 0.12
$openBorder = Blend $accentText $backgroundText 0.32
$open.Background = Get-Brush $openBg $openBg
$open.BorderBrush = Get-Brush $openBorder $openBorder
$open.BorderThickness = New-Object System.Windows.Thickness 1
$open.Padding = New-Object System.Windows.Thickness 14, 6, 14, 6
$open.Cursor = [System.Windows.Input.Cursors]::Hand
$null = $footerLeft.Children.Add($open)

$openLabelText = New-Object System.Windows.Controls.TextBlock
$openLabelText.Text = $openLabel
$openLabelText.FontSize = 12.5
$openLabelText.FontWeight = [System.Windows.FontWeights]::SemiBold
$openLabelText.Foreground = $accentBrush
$open.Child = $openLabelText
$open.Add_MouseEnter({ $hoverBg = Blend $accentText $backgroundText 0.2; $open.Background = Get-Brush $hoverBg $hoverBg })
$open.Add_MouseLeave({ $open.Background = Get-Brush $openBg $openBg })

# Кнопка приглушения звука — та же, что во внутренних плашках.
$mute = New-Object System.Windows.Controls.Border
$mute.CornerRadius = New-Object System.Windows.CornerRadius 9
$muteBg = Blend $foregroundText $backgroundText 0.08
$muteBorder = Blend $foregroundText $backgroundText 0.16
$mute.Background = Get-Brush $muteBg $muteBg
$mute.BorderBrush = Get-Brush $muteBorder $muteBorder
$mute.BorderThickness = New-Object System.Windows.Thickness 1
$mute.Padding = New-Object System.Windows.Thickness 10, 5, 10, 5
$mute.Margin = New-Object System.Windows.Thickness 8, 0, 0, 0
$mute.Cursor = [System.Windows.Input.Cursors]::Hand
$mute.ToolTip = [string]$json.muteLabel
$null = $footerLeft.Children.Add($mute)

$muteGlyph = New-Object System.Windows.Controls.TextBlock
$muteGlyph.Text = [string][char]::ConvertFromUtf32(0x1F515)
$muteGlyph.FontSize = 12.5
$muteGlyph.Foreground = $mutedBrush
$mute.Child = $muteGlyph
$mute.Add_MouseEnter({ $muteGlyph.Foreground = $fgBrush })
$mute.Add_MouseLeave({ $muteGlyph.Foreground = $mutedBrush })
$mute.Add_MouseLeftButtonUp({
  if (-not [string]::IsNullOrWhiteSpace($actionFile)) {
    try { [System.IO.File]::WriteAllText($actionFile, "mute", [System.Text.Encoding]::UTF8) } catch { }
  }
  $script:result = 11
  $script:window.Close()
})

$clockText = New-Object System.Windows.Controls.TextBlock
$clockText.Text = [string]$json.clock
$clockText.FontSize = $metaSize
$clockText.Foreground = $mutedBrush
$clockText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$clockText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
[System.Windows.Controls.Grid]::SetColumn($clockText, 1)
$null = $footer.Children.Add($clockText)

function Request-Open {
  if (-not [string]::IsNullOrWhiteSpace($actionFile)) {
    try {
      [System.IO.File]::WriteAllText($actionFile, 'open', [System.Text.Encoding]::UTF8)
    } catch {
    }
  }
  $script:openRequested = $true
  $script:result = 10
  $script:window.Close()
}

$open.Add_MouseLeftButtonUp({ Request-Open })

if ($SelfTest) {
  $script:window.Add_Loaded({
    $script:tap = New-Object System.Windows.Threading.DispatcherTimer
    $script:tap.Interval = [TimeSpan]::FromMilliseconds(600)
    $script:tap.Add_Tick({
      $script:tap.Stop()
      Request-Open
    })
    $script:tap.Start()
  })
}

# Позиция карточки: считаем после реальной раскладки, иначе ActualHeight = 0
# и окно уезжает за нижний край экрана — его просто не видно.
function Set-CardPosition {
  try {
    $area = [System.Windows.SystemParameters]::WorkArea
    $cardWidth = $script:window.ActualWidth
    if ($null -eq $cardWidth -or $cardWidth -le 0) { $cardWidth = $script:window.Width }
    if ($null -eq $cardWidth -or $cardWidth -le 0) { $cardWidth = $width }
    $cardHeight = $script:window.ActualHeight
    if ($null -eq $cardHeight -or $cardHeight -le 0) { $cardHeight = 130 }
    $gap = 20
    $stack = $offset * ($cardHeight + 10)
    $left = if ($corner -like '*-right') { $area.Right - $cardWidth - $gap } else { $area.Left + $gap }
    $top = if ($corner -like 'top-*') { $area.Top + $gap + $stack } else { $area.Bottom - $cardHeight - $gap - $stack }
    if ($left -lt $area.Left) { $left = $area.Left + $gap }
    if ($left + $cardWidth -gt $area.Right) { $left = $area.Right - $cardWidth - $gap }
    if ($top -lt $area.Top) { $top = $area.Top + $gap }
    if ($top + $cardHeight -gt $area.Bottom) { $top = $area.Bottom - $cardHeight - $gap }
    $script:window.Left = $left
    $script:window.Top = $top
  } catch {
  }
}

$script:window.Add_Loaded({
  Set-CardPosition
  # Появление как у внутренних плашек: карточка мягко подъезжает снизу.
  $script:finalTop = $script:window.Top
  $script:animStep = 0
  $script:animTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:animTimer.Interval = [TimeSpan]::FromMilliseconds(15)
  $script:animTimer.Add_Tick({
    $script:animStep += 1
    $progress = [Math]::Min(1.0, $script:animStep / 12.0)
    $script:window.Top = $script:finalTop + (12 * (1 - $progress))
    if ($progress -ge 1.0) { $script:animTimer.Stop() }
  })
  $script:animTimer.Start()
  # Ещё раз после отрисовки: высота карточки становится известна только тогда.
  try {
    $script:window.Dispatcher.BeginInvoke(
      [System.Windows.Threading.DispatcherPriority]::ContextIdle,
      [Action]{ Set-CardPosition }
    ) | Out-Null
  } catch {
  }
})

if ($durationMs -gt 0) {
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds($durationMs)
  $timer.Add_Tick({
    $timer.Stop()
    $script:window.Close()
  })
  $timer.Start()
}

$app = New-Object System.Windows.Application
$app.ShutdownMode = [System.Windows.ShutdownMode]::OnMainWindowClose
try {
  [void]$app.Run($script:window)
} catch {
  exit 2
}

# The card is gone; only now raise the window the person meant to open, so the
# topmost card cannot sit above the window being brought forward.
if ($script:openRequested) { Show-TargetWindow }

exit $script:result
