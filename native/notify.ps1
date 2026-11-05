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
    return GetForegroundWindow() == hWnd;
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

function Show-TargetWindow {
  $plan = Get-OpenPlan
  if ($plan.mode -eq 'app') {
    if ($plan.hwnd -ne 0 -and $script:windowApi) {
      if ([DshNotifyNative]::Focus([IntPtr]$plan.hwnd)) { return }
    }
    if (-not (Start-AppOpen)) { return }
    # The application was asked to show itself; give it a moment, then make sure
    # the restored window really is in front.
    $deadline = [DateTime]::UtcNow.AddMilliseconds(2500)
    do {
      Start-Sleep -Milliseconds 120
      $target = Select-AppWindow (Get-WindowRows) @(Get-AppPids)
      if ($null -ne $target -and $target.Visible -eq $true) {
        [void][DshNotifyNative]::Focus([IntPtr]$target.Hwnd)
        return
      }
    } while ([DateTime]::UtcNow -lt $deadline)
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
$root.CornerRadius = New-Object System.Windows.CornerRadius 14
$root.Background = $bgBrush
$root.BorderBrush = $borderBrush
$root.BorderThickness = New-Object System.Windows.Thickness 1
$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$shadow.BlurRadius = 22
$shadow.ShadowDepth = 5
$shadow.Opacity = 0.38
$shadow.Color = [System.Windows.Media.Color]::FromArgb(255, 0, 0, 0)
$root.Effect = $shadow
$script:window.Content = $root

$grid = New-Object System.Windows.Controls.Grid
$accentColumn = New-Object System.Windows.Controls.ColumnDefinition
$accentColumn.Width = New-Object System.Windows.GridLength 4
$bodyColumn = New-Object System.Windows.Controls.ColumnDefinition
$bodyColumn.Width = New-Object System.Windows.GridLength 1, ([System.Windows.GridUnitType]::Star)
$grid.ColumnDefinitions.Add($accentColumn)
$grid.ColumnDefinitions.Add($bodyColumn)
$root.Child = $grid

$accentBar = New-Object System.Windows.Controls.Border
$accentBar.Background = $accentBrush
$accentBar.CornerRadius = New-Object System.Windows.CornerRadius 6, 0, 0, 6
[System.Windows.Controls.Grid]::SetColumn($accentBar, 0)
$grid.Children.Add($accentBar)

$body = New-Object System.Windows.Controls.StackPanel
$body.Margin = New-Object System.Windows.Thickness 14, 12, 14, 12
[System.Windows.Controls.Grid]::SetColumn($body, 1)
$grid.Children.Add($body)

$header = New-Object System.Windows.Controls.Grid
$titleColumn = New-Object System.Windows.Controls.ColumnDefinition
$titleColumn.Width = New-Object System.Windows.GridLength 1, ([System.Windows.GridUnitType]::Star)
$closeColumn = New-Object System.Windows.Controls.ColumnDefinition
$closeColumn.Width = New-Object System.Windows.GridLength 0, ([System.Windows.GridUnitType]::Auto)
$header.ColumnDefinitions.Add($titleColumn)
$header.ColumnDefinitions.Add($closeColumn)
$body.Children.Add($header)

$title = New-Object System.Windows.Controls.TextBlock
$title.Text = [string]$json.title
$title.FontSize = $titleSize
$title.FontWeight = [System.Windows.FontWeights]::SemiBold
$title.Foreground = $fgBrush
$title.TextWrapping = [System.Windows.TextWrapping]::Wrap
$title.FontStyle = $styleValue
$title.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$title.Margin = New-Object System.Windows.Thickness 0, 0, 8, 0
[System.Windows.Controls.Grid]::SetColumn($title, 0)
$header.Children.Add($title)

# The close affordance: a full round target in the top-right corner, large
# enough to hit without aiming.
$close = New-Object System.Windows.Controls.Border
$close.Width = 30
$close.Height = 30
$close.CornerRadius = New-Object System.Windows.CornerRadius 15
$close.Background = Get-Brush (Blend $foregroundText $backgroundText 0.07) '#26FFFFFF'
$close.Cursor = [System.Windows.Input.Cursors]::Hand
$close.ToolTip = $dismissLabel
[System.Windows.Controls.Grid]::SetColumn($close, 1)
$header.Children.Add($close)

$closeGlyph = New-Object System.Windows.Controls.TextBlock
$closeGlyph.Text = [char]0x2715
$closeGlyph.FontSize = 15
$closeGlyph.FontWeight = [System.Windows.FontWeights]::Normal
$closeGlyph.Foreground = $mutedBrush
$closeGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$closeGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$closeGlyph.Margin = New-Object System.Windows.Thickness 0, -1, 0, 0
$close.Child = $closeGlyph

$close.Add_MouseEnter({
  $script:closeHover = $true
  $close.Background = Get-Brush ([string]$json.closeHoverBackground) '#4DFFFFFF'
  $closeGlyph.Foreground = $fgBrush
})
$close.Add_MouseLeave({
  $script:closeHover = $false
  $close.Background = Get-Brush (Blend $foregroundText $backgroundText 0.07) '#26FFFFFF'
  $closeGlyph.Foreground = $mutedBrush
})
$close.Add_MouseLeftButtonUp({
  $script:result = 0
  $script:window.Close()
})

$bodyText = New-Object System.Windows.Controls.TextBlock
$bodyText.Text = [string]$json.body
$bodyText.Margin = New-Object System.Windows.Thickness 0, 6, 0, 0
$bodyText.FontSize = $bodySize
$bodyText.Foreground = $fgBrush
$bodyText.TextWrapping = [System.Windows.TextWrapping]::Wrap
$bodyText.FontWeight = $weightValue
$bodyText.FontStyle = $styleValue
$body.Children.Add($bodyText)

if (-not [string]::IsNullOrWhiteSpace([string]$json.meta)) {
  $metaText = New-Object System.Windows.Controls.TextBlock
  $metaText.Text = [string]$json.meta
  $metaText.Margin = New-Object System.Windows.Thickness 0, 5, 0, 0
  $metaText.FontSize = $metaSize
  $metaText.Foreground = $mutedBrush
  $metaText.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $metaText.FontStyle = $styleValue
  $body.Children.Add($metaText)
}

$actions = New-Object System.Windows.Controls.StackPanel
$actions.Orientation = [System.Windows.Controls.Orientation]::Horizontal
$actions.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
$actions.Margin = New-Object System.Windows.Thickness 0, 11, 0, 0
$body.Children.Add($actions)

$open = New-Object System.Windows.Controls.Border
$open.CornerRadius = New-Object System.Windows.CornerRadius 9
$open.Background = Get-Brush (Blend $accentText $backgroundText 0.12) '#1A38C98A'
$open.BorderBrush = Get-Brush (Blend $accentText $backgroundText 0.32) '#5238C98A'
$open.BorderThickness = New-Object System.Windows.Thickness 1
$open.Padding = New-Object System.Windows.Thickness 14, 6, 14, 6
$open.Cursor = [System.Windows.Input.Cursors]::Hand
$open.Child = $null
$actions.Children.Add($open)

$openLabelText = New-Object System.Windows.Controls.TextBlock
$openLabelText.Text = $openLabel
$openLabelText.FontSize = 12.5
$openLabelText.FontWeight = [System.Windows.FontWeights]::SemiBold
$openLabelText.Foreground = $accentBrush
$open.Child = $openLabelText

$open.Add_MouseEnter({ $open.Background = Get-Brush (Blend $accentText $backgroundText 0.2) '#3338C98A' })
$open.Add_MouseLeave({ $open.Background = Get-Brush (Blend $accentText $backgroundText 0.12) '#1A38C98A' })

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

$script:window.Add_Loaded({
  try {
    $area = [System.Windows.SystemParameters]::WorkArea
    $height = $script:window.ActualHeight
    $gap = 20
    $stack = $offset * ($height + 10)
    $left = if ($corner -like '*-right') { $area.Right - $script:window.ActualWidth - $gap } else { $area.Left + $gap }
    $top = if ($corner -like 'top-*') { $area.Top + $gap + $stack } else { $area.Bottom - $height - $gap - $stack }
    $script:window.Left = $left
    $script:window.Top = $top
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
