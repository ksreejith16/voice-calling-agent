# Voice worker — reserved for Deliverable 3

This directory reserves the service boundary. No Python runner or voice dependencies
are implemented. Deliverables 1 and 2 must be reviewed before this work starts.

After explicit review authorization, build the separate Python LiveKit Agents worker
with verified Sarvam Saaras Realtime STT, Bulbul v3 streaming TTS, Silero VAD,
generation cancellation and playback-buffer clearing. Verify Exotel SIP/media and
authoritative duration enforcement before claiming prepaid exposure guarantees.

Measure p95 < 500 ms from actual caller end of speech to the first meaningful audible
response at the caller endpoint, including endpointing, transport and playback.
State the language/network/load profile and report tool-dependent turns separately.
No voice latency, quality, interruption or concurrency result exists yet.
