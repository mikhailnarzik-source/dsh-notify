param(
  [Parameter(Mandatory = $true)][string]$PayloadBase64,
  # Exercises the "open" action without a pointer; never passed by the Host.
  [switch]$SelfTest
)

# Always-on-top notification card for Windows.
#
# Runs as its own short-lived process so the card can float above every other
# application, which the in-app web overlay cannot do. One JSON payload (base64
# UTF-8) carries the localized text, the theme palette and the geometry.
#
# Exit codes: 0 closed or timed out, 2 the card could not be built, 10 the
# person pressed "open" (the caller then focuses the app and opens the chat).

$ErrorActionPreference = 'Stop'
$script:result = 0

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

try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DshNotifyNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
}
"@
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

function Invoke-Open {
  try {
    $processes = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like '*Harness*' -or $_.MainWindowTitle -like '*Harness*' -or $_.MainWindowTitle -like '*DeepSeek*')
    }
    foreach ($target in $processes) {
      $handle = $target.MainWindowHandle
      if ($handle -eq [IntPtr]::Zero) { continue }
      # Restore only a minimized window: SW_RESTORE would also un-maximize a
      # fullscreen or maximized window, and the person must get it back exactly
      # as it was.
      if ([DshNotifyNative]::IsIconic($handle)) {
        [void][DshNotifyNative]::ShowWindow($handle, 9)
      }
      [void][DshNotifyNative]::BringWindowToTop($handle)
      if ([DshNotifyNative]::GetForegroundWindow() -ne $handle) {
        [void][DshNotifyNative]::SetForegroundWindow($handle)
        if ([DshNotifyNative]::GetForegroundWindow() -ne $handle) {
          try { [DshNotifyNative]::SwitchToThisWindow($handle, $true) } catch {
          }
        }
      }
      if ([DshNotifyNative]::GetForegroundWindow() -eq $handle) { break }
    }
  } catch {
  }
  if (-not [string]::IsNullOrWhiteSpace($actionFile)) {
    try {
      [System.IO.File]::WriteAllText($actionFile, 'open', [System.Text.Encoding]::UTF8)
    } catch {
    }
  }
  $script:result = 10
  $script:window.Close()
}

$open.Add_MouseLeftButtonUp({ Invoke-Open })

if ($SelfTest) {
  $script:window.Add_Loaded({
    $script:tap = New-Object System.Windows.Threading.DispatcherTimer
    $script:tap.Interval = [TimeSpan]::FromMilliseconds(600)
    $script:tap.Add_Tick({
      $script:tap.Stop()
      Invoke-Open
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

exit $script:result
