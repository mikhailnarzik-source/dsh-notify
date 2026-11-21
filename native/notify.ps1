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
  # Понимает и #RRGGBB, и #AARRGGBB: иначе все смешения молча падали в фон.
  try {
    $fg = $foreground.Trim()
    if ($fg.StartsWith("#")) { $fg = $fg.Substring(1) }
    if ($fg.Length -eq 8) { $fg = $fg.Substring(2) }
    $bg = $background.Trim()
    if ($bg.StartsWith("#")) { $bg = $bg.Substring(1) }
    if ($bg.Length -eq 8) { $bg = $bg.Substring(2) }
    $r = [Math]::Round([Convert]::ToInt32($fg.Substring(0, 2), 16) * $amount + [Convert]::ToInt32($bg.Substring(0, 2), 16) * (1 - $amount))
    $g = [Math]::Round([Convert]::ToInt32($fg.Substring(2, 2), 16) * $amount + [Convert]::ToInt32($bg.Substring(2, 2), 16) * (1 - $amount))
    $b = [Math]::Round([Convert]::ToInt32($fg.Substring(4, 2), 16) * $amount + [Convert]::ToInt32($bg.Substring(4, 2), 16) * (1 - $amount))
    return ("#{0:X2}{1:X2}{2:X2}" -f [Math]::Min(255, $r), [Math]::Min(255, $g), [Math]::Min(255, $b))
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
$script:window.SizeToContent = [System.Windows.SizeToContent]::Manual
$script:window.Height = 96
$script:window.Width = $width
$script:window.FontFamily = New-Object System.Windows.Media.FontFamily $fontFamilyName

$root = New-Object System.Windows.Controls.Border
$root.CornerRadius = New-Object System.Windows.CornerRadius 16
# Фон — градиент от цвета типа уведомления к тёмной основе DSH.
$gradientStart = Get-Brush (Blend $accentText $backgroundText 0.45) $backgroundText
$gradientEnd = Get-Brush (Blend $accentText $backgroundText 0.04) $backgroundText
$gradientBrush = New-Object System.Windows.Media.LinearGradientBrush
$gradientBrush.StartPoint = New-Object System.Windows.Point 0, 0
$gradientBrush.EndPoint = New-Object System.Windows.Point 1, 1
$gradientBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop $gradientStart.Color, 0))
$gradientBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop $gradientEnd.Color, 1))
$root.Background = $gradientBrush
$root.BorderBrush = $borderBrush
$root.BorderThickness = New-Object System.Windows.Thickness 1
$root.Effect = $null
$script:scaleTransform = New-Object System.Windows.Media.ScaleTransform 1, 1
$root.RenderTransform = $script:scaleTransform
$root.RenderTransformOrigin = New-Object System.Windows.Point 1, 0.5
$script:window.Content = $root

$body = New-Object System.Windows.Controls.StackPanel
$body.Margin = New-Object System.Windows.Thickness 12, 9, 16, 9
$body.Width = $width - 28
$root.Child = $body

# Шапка: иконка, заголовок с подзаголовком, крестик.
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
$iconCircle.Width = 24
$iconCircle.Height = 24
$iconCircle.CornerRadius = New-Object System.Windows.CornerRadius 12
$iconBg = Blend $accentText $backgroundText 0.30
$iconBorder = Blend $accentText $backgroundText 0.55
$iconCircle.Background = Get-Brush $iconBg $iconBg
$iconCircle.BorderBrush = Get-Brush $iconBorder $iconBorder
$iconCircle.BorderThickness = New-Object System.Windows.Thickness 1
$iconCircle.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$iconCircle.Margin = New-Object System.Windows.Thickness 0, 0, 10, 0
[System.Windows.Controls.Grid]::SetColumn($iconCircle, 0)
$null = $header.Children.Add($iconCircle)

$iconGlyph = New-Object System.Windows.Controls.TextBlock
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
$iconGlyph.FontSize = 12.5
$iconGlyph.FontWeight = [System.Windows.FontWeights]::Bold
$iconGlyph.Foreground = $accentBrush
$iconGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$iconGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$iconCircle.Child = $iconGlyph

$heading = New-Object System.Windows.Controls.StackPanel
[System.Windows.Controls.Grid]::SetColumn($heading, 1)
$heading.Margin = New-Object System.Windows.Thickness 0, 0, 10, 0
$null = $header.Children.Add($heading)

$title = New-Object System.Windows.Controls.TextBlock
$title.Text = [string]$json.title
$title.FontSize = 13
$title.FontWeight = [System.Windows.FontWeights]::SemiBold
$title.Foreground = $fgBrush
$title.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
$title.FontStyle = $styleValue
$null = $heading.Children.Add($title)

$subtitleText = [string]$json.subtitle
if ([string]::IsNullOrWhiteSpace($subtitleText)) { $subtitleText = [string]$json.meta }
if (-not [string]::IsNullOrWhiteSpace($subtitleText) -and $subtitleText.Trim() -ne ([string]$json.title).Trim()) {
  $subtitle = New-Object System.Windows.Controls.TextBlock
  $subtitle.Text = $subtitleText
  $subtitle.Margin = New-Object System.Windows.Thickness 0, 1, 0, 0
  $subtitle.FontSize = 11
  $subtitle.Foreground = $mutedBrush
  $subtitle.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
  $subtitle.FontStyle = $styleValue
  $null = $heading.Children.Add($subtitle)
}

$close = New-Object System.Windows.Controls.Border
$close.Width = 24
$close.Height = 24
$close.CornerRadius = New-Object System.Windows.CornerRadius 12
$closeBg = Blend $foregroundText $backgroundText 0.07
$close.Background = Get-Brush $closeBg $closeBg
$close.Cursor = [System.Windows.Input.Cursors]::Hand
$close.ToolTip = $dismissLabel
$close.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
[System.Windows.Controls.Grid]::SetColumn($close, 2)
$null = $header.Children.Add($close)

$closeGlyph = New-Object System.Windows.Controls.TextBlock
$closeGlyph.Text = [string][char]0x2715
$closeGlyph.FontSize = 12
$closeGlyph.Foreground = $mutedBrush
$closeGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$closeGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$close.Child = $closeGlyph
$close.Add_MouseEnter({ $closeHoverBg = Blend $foregroundText $backgroundText 0.16; $close.Background = Get-Brush $closeHoverBg $closeHoverBg; $closeGlyph.Foreground = $fgBrush })
$close.Add_MouseLeave({ $close.Background = Get-Brush $closeBg $closeBg; $closeGlyph.Foreground = $mutedBrush })
$close.Add_MouseLeftButtonUp({ Close-Card 0 })

# Текст уведомления одной строкой.
$bodyText = New-Object System.Windows.Controls.TextBlock
$bodyText.Text = [string]$json.body
$bodyText.Margin = New-Object System.Windows.Thickness 0, 5, 0, 0
$bodyText.FontSize = 12.5
$bodyText.Foreground = $fgBrush
$bodyText.TextWrapping = [System.Windows.TextWrapping]::NoWrap
$bodyText.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
$bodyText.Width = $width - 28
$bodyText.FontStyle = $styleValue
$null = $body.Children.Add($bodyText)

# Разделитель между текстом и действиями.
$divider = New-Object System.Windows.Controls.Border
$divider.Height = 1
$dividerBg = Blend $foregroundText $backgroundText 0.10
$divider.Background = Get-Brush $dividerBg $dividerBg
$divider.Margin = New-Object System.Windows.Thickness 0, 7, 0, 0
$null = $body.Children.Add($divider)

# Нижняя строка: действия слева, время и таймер справа в две строки.
$footer = New-Object System.Windows.Controls.Grid
$footer.Margin = New-Object System.Windows.Thickness 0, 6, 0, 0
$footer.Width = $width - 36
$actionsColumn = New-Object System.Windows.Controls.ColumnDefinition
$actionsColumn.Width = New-Object System.Windows.GridLength 1, ([System.Windows.GridUnitType]::Star)
$metaColumn = New-Object System.Windows.Controls.ColumnDefinition
$metaColumn.Width = New-Object System.Windows.GridLength 0, ([System.Windows.GridUnitType]::Auto)
$footer.ColumnDefinitions.Add($actionsColumn)
$footer.ColumnDefinitions.Add($metaColumn)
$null = $body.Children.Add($footer)

$actions = New-Object System.Windows.Controls.StackPanel
$actions.Orientation = [System.Windows.Controls.Orientation]::Horizontal
$actions.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
[System.Windows.Controls.Grid]::SetColumn($actions, 0)
$null = $footer.Children.Add($actions)

$open = New-Object System.Windows.Controls.Border
$open.CornerRadius = New-Object System.Windows.CornerRadius 8
$openBg = Blend $accentText $backgroundText 0.24
$openBorder = Blend $accentText $backgroundText 0.6
$open.Background = Get-Brush $openBg $openBg
$open.BorderBrush = Get-Brush $openBorder $openBorder
$open.BorderThickness = New-Object System.Windows.Thickness 1
$open.Padding = New-Object System.Windows.Thickness 10, 3, 10, 3
$open.Cursor = [System.Windows.Input.Cursors]::Hand
$null = $actions.Children.Add($open)

$openLabelText = New-Object System.Windows.Controls.TextBlock
$openLabelText.Text = $openLabel
$openLabelText.FontSize = 12
$openLabelText.FontWeight = [System.Windows.FontWeights]::SemiBold
$openLabelText.Foreground = $accentBrush
$open.Child = $openLabelText
$open.Add_MouseEnter({ $hoverBg = Blend $accentText $backgroundText 0.2; $open.Background = Get-Brush $hoverBg $hoverBg })
$open.Add_MouseLeave({ $open.Background = Get-Brush $openBg $openBg })

$mute = New-Object System.Windows.Controls.Border
$mute.CornerRadius = New-Object System.Windows.CornerRadius 8
$muteBg = Blend $foregroundText $backgroundText 0.14
$muteBorder = Blend $foregroundText $backgroundText 0.28
$mute.Background = Get-Brush $muteBg $muteBg
$mute.BorderBrush = Get-Brush $muteBorder $muteBorder
$mute.BorderThickness = New-Object System.Windows.Thickness 1
$mute.Padding = New-Object System.Windows.Thickness 7, 3, 7, 3
$mute.Margin = New-Object System.Windows.Thickness 6, 0, 0, 0
$mute.Cursor = [System.Windows.Input.Cursors]::Hand
$mute.ToolTip = [string]$json.muteLabel
$null = $actions.Children.Add($mute)

$muteGlyph = New-Object System.Windows.Controls.TextBlock
$muteGlyph.Text = [string][char]::ConvertFromUtf32(0x1F515)
$muteGlyph.FontSize = 11
$muteGlyph.Foreground = $mutedBrush
$mute.Child = $muteGlyph
$mute.Add_MouseEnter({ $muteGlyph.Foreground = $fgBrush })
$mute.Add_MouseLeave({ $muteGlyph.Foreground = $mutedBrush })
$mute.Add_MouseLeftButtonUp({
  if (-not [string]::IsNullOrWhiteSpace($actionFile)) {
    try { [System.IO.File]::WriteAllText($actionFile, "mute", [System.Text.Encoding]::UTF8) } catch { }
  }
  Close-Card 11
})

$meta = New-Object System.Windows.Controls.StackPanel
$meta.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$meta.Margin = New-Object System.Windows.Thickness 0, 0, 6, 0
[System.Windows.Controls.Grid]::SetColumn($meta, 1)
$null = $footer.Children.Add($meta)

$stampText = New-Object System.Windows.Controls.TextBlock
$stampText.Text = [string]$json.stamp
$stampText.FontSize = 11.5
$stampReadable = Blend $foregroundText $backgroundText 0.78
$stampText.Foreground = Get-Brush $stampReadable $stampReadable
$stampText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
$null = $meta.Children.Add($stampText)

$elapsedText = New-Object System.Windows.Controls.TextBlock
$elapsedText.Text = "висит 0:00"
$elapsedText.FontSize = 11.5
$elapsedText.Foreground = Get-Brush $stampReadable $stampReadable
$elapsedText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
$null = $meta.Children.Add($elapsedText)

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
function Get-CardTarget {
  try {
    $area = [System.Windows.SystemParameters]::WorkArea
    $cardWidth = $script:window.ActualWidth
    if ($null -eq $cardWidth -or $cardWidth -le 0) { $cardWidth = $script:window.Width }
    $cardHeight = $script:window.ActualHeight
    if ($null -eq $cardHeight -or $cardHeight -le 0) { $cardHeight = 128 }
    $gap = 10
    $slot = 0
    if ($null -ne $json.slot) { $slot = [Math]::Max(0, [int]$json.slot) } elseif ($null -ne $json.offset) { $slot = [Math]::Max(0, [int]$json.offset) }
    $left = if ($corner -like '*-right') { $area.Right - $cardWidth - 16 } else { $area.Left + 16 }
    $top = if ($corner -like 'top-*') { $area.Top + 16 + $slot * ($cardHeight + $gap) } else { $area.Bottom - $cardHeight - 16 - $slot * ($cardHeight + $gap) }
    return @{ left = $left; top = $top }
  } catch {
    return @{ left = 100; top = 100 }
  }
}

# Плавная анимация средствами WPF: композитор интерполирует сам, без дёрганья таймера.
function Animate-Card([double]$targetLeft, [double]$targetTop, [int]$durationMs, [switch]$NoFade) {
  try {
    $ease = New-Object System.Windows.Media.Animation.CubicEase
    $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut
    $span = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds($durationMs))
    $fromLeft = $script:window.Left
    $fromTop = $script:window.Top
    $leftAnim = New-Object System.Windows.Media.Animation.DoubleAnimation
    $leftAnim.From = $fromLeft
    $leftAnim.To = $targetLeft
    $leftAnim.Duration = $span
    $leftAnim.EasingFunction = $ease
    $script:window.BeginAnimation([System.Windows.Window]::LeftProperty, $leftAnim)
    $topAnim = New-Object System.Windows.Media.Animation.DoubleAnimation
    $topAnim.From = $fromTop
    $topAnim.To = $targetTop
    $topAnim.Duration = $span
    $topAnim.EasingFunction = $ease
    $script:window.BeginAnimation([System.Windows.Window]::TopProperty, $topAnim)
    $script:animEndLeft = $targetLeft
    $script:animEndTop = $targetTop
    $script:animEndTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:animEndTimer.Interval = [TimeSpan]::FromMilliseconds($durationMs + 40)
    $script:animEndTimer.Add_Tick({
      $script:animEndTimer.Stop()
      try {
        $script:window.BeginAnimation([System.Windows.Window]::LeftProperty, $null)
        $script:window.BeginAnimation([System.Windows.Window]::TopProperty, $null)
        $script:window.Left = $script:animEndLeft
        $script:window.Top = $script:animEndTop
        if (-not $NoFade) {
          $script:window.BeginAnimation([System.Windows.Window]::OpacityProperty, $null)
          $script:window.Opacity = 1
        }
      } catch { }
    })
    $script:animEndTimer.Start()
    if (-not $NoFade) {
      $scaleX = New-Object System.Windows.Media.Animation.DoubleAnimation
      $scaleX.From = 0.97
      $scaleX.To = 1
      $scaleX.Duration = $span
      $scaleX.EasingFunction = $ease
      $script:scaleTransform.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $scaleX)
      $scaleY = New-Object System.Windows.Media.Animation.DoubleAnimation
      $scaleY.From = 0.97
      $scaleY.To = 1
      $scaleY.Duration = $span
      $scaleY.EasingFunction = $ease
      $script:scaleTransform.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $scaleY)
      $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
      $fade.From = 0
      $fade.To = 1
      $fade.Duration = $span
      $fade.EasingFunction = $ease
      $script:window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fade)
    }
  } catch {
  }
}

# Закрытие: сначала короткое растворение, потом окно закрывается.
function Close-Card([int]$result = 0) {
  $script:result = $result
  try {
    $ease = New-Object System.Windows.Media.Animation.QuadraticEase
    $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseIn
    $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
    $fade.To = 0
    $fade.Duration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(140))
    $fade.EasingFunction = $ease
    $script:window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fade)
    $script:closeTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:closeTimer.Interval = [TimeSpan]::FromMilliseconds(150)
    $script:closeTimer.Add_Tick({ $script:closeTimer.Stop(); $script:window.Close() })
    $script:closeTimer.Start()
  } catch {
    $script:window.Close()
  }
}

function Set-CardPosition {
  $target = Get-CardTarget
  try {
    $script:window.BeginAnimation([System.Windows.Window]::LeftProperty, $null)
    $script:window.BeginAnimation([System.Windows.Window]::TopProperty, $null)
  } catch { }
  $script:window.Left = $target.left
  $script:window.Top = $target.top
}


$script:window.Add_Loaded({
  # Появление из-за правого края: короткий выезд + растворение, 200 мс ease-out.
  $target = Get-CardTarget
  $script:window.Opacity = 0
  $script:window.Top = $target.top
  $script:window.Left = $target.left + 30
  $script:entryTarget = $target
  $script:window.Dispatcher.BeginInvoke([System.Windows.Threading.DispatcherPriority]::Render, [Action]{ Animate-Card $script:entryTarget.left $script:entryTarget.top 230 }) | Out-Null
  $script:startedAt = [DateTime]::Now
  if ($null -ne $json.startedAt) { try { $script:startedAt = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$json.startedAt).LocalDateTime } catch { } }
  $script:elapsedTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:elapsedTimer.Interval = [TimeSpan]::FromMilliseconds(500)
  $script:elapsedTimer.Add_Tick({
    try {
      $seconds = [int]([DateTime]::Now - $script:startedAt).TotalSeconds
      if ($seconds -lt 0) { $seconds = 0 }
      $elapsedText.Text = ("{0}:{1:00}" -f [int]($seconds / 60), ($seconds % 60))
      if (-not [string]::IsNullOrWhiteSpace($actionFile)) {
        $raw = ""
        try { $raw = [System.IO.File]::ReadAllText($actionFile) } catch { }
        if ($raw.StartsWith("slot:")) {
          try { $json.slot = [int]$raw.Substring(5) } catch { }
          $late = Get-CardTarget
          Animate-Card $late.left $late.top 220 -NoFade
          try { [System.IO.File]::WriteAllText($actionFile, "", [System.Text.Encoding]::UTF8) } catch { }
        }
      }
    } catch { }
  })
  $script:elapsedTimer.Start()
  try {
    $script:window.SizeToContent = [System.Windows.SizeToContent]::Manual
    $probe = New-Object System.Windows.Size (($width - 30), [double]::PositiveInfinity)
    $body.Measure($probe)
    $needed = [Math]::Ceiling($body.DesiredSize.Height) + 20
    if ($needed -gt 40) { $script:window.Height = $needed }
  } catch {
  }
  # Ещё раз после отрисовки: высота карточки становится известна только тогда.
  try {
    $script:window.Dispatcher.BeginInvoke(
      [System.Windows.Threading.DispatcherPriority]::ContextIdle,
      [Action]{ $late = Get-CardTarget; Animate-Card $late.left $late.top 220 -NoFade }
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
