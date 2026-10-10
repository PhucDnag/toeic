# Run with Windows PowerShell (System.Speech). Creates a synthetic, silent-to-speakers test file.
param([string]$OutputPath = (Join-Path $env:TEMP 'toeic-listening-smoke.wav'))
Add-Type -AssemblyName System.Speech
$tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $tts.SelectVoice('Microsoft David Desktop')
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $tts.SetOutputToWaveFile($OutputPath, $format)
    $prompt = New-Object System.Speech.Synthesis.PromptBuilder
    for ($n = 12; $n -le 20; $n++) {
        $prompt.AppendText("Number $n.")
        $prompt.AppendBreak([TimeSpan]::FromMilliseconds(400))
        switch (($n - 12) % 3) {
            0 { $lines = @('Who ordered these vegetables?', 'A. All of it.', 'B. I believe Luis did.', 'C. It was excellent.') }
            1 { $lines = @('How often should I mail the notices?', 'A. Once a month.', 'B. After three o clock.', 'C. About half of them.') }
            2 { $lines = @('Which folder are the documents in?', 'A. We agreed on the deadline.', 'B. Sure, I will take a look.', 'C. Let me show you.') }
        }
        foreach ($line in $lines) {
            $prompt.AppendText($line)
            $prompt.AppendBreak([TimeSpan]::FromMilliseconds(600))
        }
        $prompt.AppendBreak([TimeSpan]::FromMilliseconds(1000))
    }
    $tts.Speak($prompt)
} finally { $tts.Dispose() }
Write-Output $OutputPath
