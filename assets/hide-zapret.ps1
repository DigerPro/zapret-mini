# Скрывает консольные окна winws.exe (заголовок содержит "zapret:").
# Вызывается панелью после запуска батника. Не меняет процессы и сеть.
$ErrorActionPreference = 'SilentlyContinue'

$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ZapretWindows
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public static int Hide()
    {
        int count = 0;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, sb.Capacity);
            if (sb.ToString().IndexOf("zapret:", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                ShowWindow(hWnd, 0);
                count++;
            }
            return true;
        }, IntPtr.Zero);
        return count;
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp

for ($i = 0; $i -lt 4; $i++) {
    [void][ZapretWindows]::Hide()
    Start-Sleep -Milliseconds 150
}
