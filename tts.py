import asyncio
import edge_tts
import io
import soundfile as sf
import sounddevice as sd
import random
import sys
import re

MAX_LEN = 300

voices = [
    "en-AU-NatashaNeural",
    "en-AU-WilliamNeural",
    "en-CA-ClaraNeural",
    "en-CA-LiamNeural",
    "en-GB-LibbyNeural",
    "en-GB-MaisieNeural",
    "en-GB-RyanNeural",
    "en-GB-SoniaNeural",
    "en-GB-ThomasNeural",
    "en-HK-SamNeural",
    "en-HK-YanNeural",
    "en-IE-ConnorNeural",
    "en-IE-EmilyNeural",
    "en-IN-NeerjaExpressiveNeural",
    "en-IN-NeerjaNeural",
    "en-IN-PrabhatNeural",
    "en-KE-AsiliaNeural",
    "en-KE-ChilembaNeural",
    "en-NG-AbeoNeural",
    "en-NG-EzinneNeural",
    "en-NZ-MitchellNeural",
    "en-NZ-MollyNeural",
    "en-PH-JamesNeural",
    "en-PH-RosaNeural",
    "en-SG-LunaNeural",
    "en-SG-WayneNeural",
    "en-TZ-ElimuNeural",
    "en-TZ-ImaniNeural",
    "en-US-AnaNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-AndrewNeural",
    "en-US-AriaNeural",
    "en-US-AvaMultilingualNeural",
    "en-US-AvaNeural",
    "en-US-BrianMultilingualNeural",
    "en-US-BrianNeural",
    "en-US-ChristopherNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-EmmaNeural",
    "en-US-EricNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-MichelleNeural",
    "en-US-RogerNeural",
    "en-US-SteffanNeural",
    "en-ZA-LeahNeural",
    "en-ZA-LukeNeural",
]

async def text_to_speech(text, voice=voices[random.randint(0, len(voices) - 1)]):
    communicate = edge_tts.Communicate(text, voice)
    audio_bytes = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes.write(chunk["data"])

    audio_bytes.seek(0)
    data, samplerate = sf.read(audio_bytes)
    sd.play(data, samplerate)
    sd.wait()

if __name__ == "__main__":
    NON_BMP_RE = re.compile(u"[^\U00000000-\U0000d7ff\U0000e000-\U0000ffff]", flags=re.UNICODE)
    stripped_text = NON_BMP_RE.sub(u'', sys.argv[1])
    stripped_text = stripped_text.replace('\\', '')
    asyncio.run(text_to_speech(stripped_text[0:MAX_LEN]))
