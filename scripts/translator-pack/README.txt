CHANAKYA AI - OFFLINE TRANSLATOR PACK
=====================================

What it is
  The IndicTrans2 translator (English <-> Tamil, Hindi, Kannada, Telugu, Malayalam) with its own Python and all
  three models, in one folder. The other PC needs no Python and no internet. It listens on 127.0.0.1 only.

Put it on a PC (two ways, pick one)
  A. Copy this whole "translator" folder into the folder that contains "Chanakya AI.exe"
     (installed app: C:\Program Files\Chanakya AI ; unpacked app: the win-unpacked folder).
  B. Run Install-Translator.cmd. It does A for you (installed app: right-click, Run as administrator).

Then
  Close Chanakya AI completely and open it again. The app starts the translator by itself; the first start
  loads the models (10-30 seconds, more on a slow PC).

Check it works on this PC
  Double-click Verify-Translator.cmd. It checks the model files against pack-manifest.json, starts the
  translator from this folder and translates one sentence each way. "ALL PASSED" means it runs here.
  It does not judge translation quality.

If translation says "unavailable"
  1. Run Start-Translator.cmd and read the messages in its window.
  2. The app also writes the translator's messages to indictrans.log in the "storage" folder inside its data folder.

Needs
  Windows 10/11 64-bit, about 5 GB free disk, and about 4 GB of free memory while the translator is loaded
  (the three models stay in memory). Set INDICTRANS_AUTOSTART=0 to stop the app starting it.

Notes
  - The pack includes Microsoft's redistributable C++ runtime DLLs beside python.exe (needed by torch).
  - Do not copy a .venv from another PC; this pack does not use one.
