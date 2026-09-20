/* Local browser harness; no tokens or transcripts are persisted. */
"use strict";

(() => {
  const byId = (id) => document.getElementById(id);

  const ui = Object.fromEntries([
    "start",
    "mute",
    "audio",
    "end",
    "connection-state",
    "session-message",
    "microphone-status",
    "agent-status",
    "audio-status",
    "session-limit",
    "transcript",
    "diagnostics",
    "remote-audio",
    "download",
    "clear-transcript",
  ].map((id) => [id, byId(id)]));

  const events = [];
  const segments = new Map();

  let room = null;
  let sessionHandle = null;
  let expiryTimer = null;
  let agentTimer = null;
  let busy = false;
  let ending = false;
  let generation = 0;

  function diagnostic(event, detail = "") {
    const entry = {
      time: new Date().toISOString(),
      elapsedMs: Math.round(performance.now()),
      event,
      detail,
    };

    events.push(entry);
    if (events.length > 500) events.shift();

    const line = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = entry.time;

    line.append(
      time,
      document.createTextNode(event + (detail ? ": " + detail : "")),
    );

    ui.diagnostics.append(line);

    while (ui.diagnostics.children.length > 500) {
      ui.diagnostics.firstChild.remove();
    }

    ui.diagnostics.scrollTop = ui.diagnostics.scrollHeight;
  }

  function state(label, style = "") {
    ui["connection-state"].textContent = label;
    ui["connection-state"].className = "state " + style;
  }

  function transcript(id, text, identity, final) {
    if (!text) return;

    let entry = segments.get(id);

    if (!entry) {
      ui.transcript.querySelector(".empty")?.remove();

      const line = document.createElement("li");
      const speaker = document.createElement("span");
      speaker.className = "speaker";
      speaker.textContent =
        identity === room?.localParticipant.identity ? "YOU" : "AGENT";

      const words = document.createElement("span");
      line.append(speaker, words);
      ui.transcript.append(line);

      entry = { line, words, final: false };
      segments.set(id, entry);

      if (segments.size > 300) {
        const oldest = segments.keys().next().value;
        segments.get(oldest).line.remove();
        segments.delete(oldest);
      }
    }

    if (entry.final && !final) return;

    entry.words.textContent = String(text).slice(0, 20000);
    entry.final = final;
    entry.line.className = final ? "" : "partial";

    ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }

  async function post(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal: AbortSignal.timeout(25000),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || "The local test service returned an error.",
      );
    }

    return result;
  }

  function audioState(activeRoom) {
    const allowed = activeRoom.canPlaybackAudio;

    ui.audio.disabled = !room;
    ui.audio.textContent = allowed
      ? "Speaker audio enabled"
      : "Enable speaker audio";

    if (!allowed) {
      ui["audio-status"].textContent = "Playback permission needed";
    }
  }

  function wireRoom(activeRoom) {
    const { RoomEvent, Track } = window.LivekitClient;

    const on = (event, handler) => {
      activeRoom.on(event, (...args) => {
        if (room === activeRoom) handler(...args);
      });
    };

    on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;

      const audio = track.attach();
      audio.autoplay = true;

      ui["remote-audio"].append(audio);
      ui["audio-status"].textContent = "Remote audio track attached";

      diagnostic(
        "remote_audio_attached",
        "This event is not an audible response timestamp",
      );

      audio.play().catch(() => {
        ui["audio-status"].textContent = "Click Enable speaker audio";
        diagnostic("audio_playback_blocked");
      });
    });

    on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());

      if (!ui["remote-audio"].children.length) {
        ui["audio-status"].textContent = "No remote track";
      }
    });

    on(RoomEvent.AudioPlaybackStatusChanged, () => {
      audioState(activeRoom);
    });

    on(RoomEvent.ParticipantConnected, () => {
      clearTimeout(agentTimer);
      ui["agent-status"].textContent = "Remote participant joined";
      diagnostic("remote_participant_joined");
    });

    on(RoomEvent.ParticipantDisconnected, () => {
      ui["agent-status"].textContent = activeRoom.remoteParticipants.size
        ? "Remote participant present"
        : "Remote participant disconnected";

      diagnostic("remote_participant_left");
    });

    on(RoomEvent.Reconnecting, () => {
      state("Reconnecting");
      ui["session-message"].textContent =
        "Connection interrupted. LiveKit is attempting to reconnect.";
      diagnostic("reconnecting");
    });

    on(RoomEvent.Reconnected, () => {
      state("Connected", "connected");
      ui["session-message"].textContent =
        "Connection restored. Continue your test.";
      diagnostic("reconnected");
    });

    on(RoomEvent.Disconnected, (reason) => {
      diagnostic("disconnected", String(reason ?? "unknown"));

      if (!ending && room === activeRoom) {
        void endSession("The LiveKit session disconnected.");
      }
    });

    on(RoomEvent.MediaDevicesError, () => {
      ui["microphone-status"].textContent = "Device access failed";

      diagnostic(
        "media_device_error",
        "Check browser microphone permission and the selected input device",
      );
    });

    on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      diagnostic(
        "connection_quality",
        `${participant.isLocal ? "browser" : "remote"}: ${quality}`,
      );
    });

    // The pinned worker publishes both legacy RTC transcriptions and text
    // streams with different IDs. Render the text-stream channel only so each
    // utterance appears once; do not deduplicate by text (real repeats matter).

    activeRoom.registerTextStreamHandler(
      "lk.transcription",
      async (reader, participant) => {
        const id =
          reader.info.attributes?.["lk.segment_id"] || reader.info.id;

        const isFinal =
          reader.info.attributes?.["lk.transcription_final"] !== "false";

        let words = "";

        try {
          for await (const chunk of reader) {
            if (room !== activeRoom) return;

            words = (words + chunk).slice(0, 20000);
            transcript(id, words, participant.identity, false);
          }

          if (room === activeRoom) {
            transcript(id, words, participant.identity, isFinal);
          }
        } catch {
          diagnostic("transcription_stream_interrupted");
        }
      },
    );
  }

  async function endSession(
    message = "Session ended. You can start another test.",
  ) {
    if (ending) return;

    ending = true;
    generation += 1;

    clearTimeout(expiryTimer);
    clearTimeout(agentTimer);

    const activeRoom = room;
    room = null;

    // Cleanup must disconnect, never reconnect.
    if (activeRoom) {
      try {
        await activeRoom.disconnect();
      } catch {
        diagnostic("disconnect_error");
      }
    }

    ui["remote-audio"].replaceChildren();
    ui["microphone-status"].textContent = "Off";
    ui["audio-status"].textContent = "No remote track";
    ui["agent-status"].textContent = "Session ended";

    ui.mute.disabled = true;
    ui.audio.disabled = true;

    state("Not connected");

    if (sessionHandle) {
      try {
        await post("/session/end", { sessionHandle });
        sessionHandle = null;
        diagnostic("room_cleanup_confirmed");
      } catch {
        message =
          "Microphone disconnected. Room cleanup could not be confirmed; " +
          "keep the local harness running and click End session to retry.";

        diagnostic("room_cleanup_pending");
      }
    }

    ui.end.disabled = !sessionHandle;
    ui.start.disabled = Boolean(sessionHandle);
    ui["session-message"].textContent = message;

    busy = false;
    ending = false;
  }

  ui.start.addEventListener("click", async () => {
    if (busy || room) return;

    if (!window.LivekitClient) {
      state("SDK unavailable", "failed");
      ui["session-message"].textContent =
        "Install the repository dependencies and restart this page.";
      return;
    }

    if (
      !navigator.mediaDevices?.getUserMedia ||
      !window.isSecureContext
    ) {
      state("Microphone unavailable", "failed");
      ui["session-message"].textContent =
        "Open the harness at http://127.0.0.1:8765 " +
        "in a browser with microphone support.";
      return;
    }

    busy = true;
    const attempt = ++generation;

    ui.start.disabled = true;
    state("Creating session");

    ui["session-message"].textContent =
      "Creating a temporary room and dispatching the configured agent…";

    try {
      const session = await post("/session", {});

      sessionHandle = session.sessionHandle;
      ui.end.disabled = false;

      const activeRoom = new window.LivekitClient.Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      room = activeRoom;
      wireRoom(activeRoom);

      diagnostic("dispatch_requested", "Waiting for a worker to join");
      ui["agent-status"].textContent =
        "Dispatch requested; waiting for worker";

      state("Connecting");

      // Connect only here, where session exists.
      try {
        await activeRoom.connect(session.url, session.token);
      } catch (error) {
        // Cleanup can run before connect() rejects. Record the original
        // failure before the outer handler checks the attempt generation.
        const detail = String(error?.message || error)
          .replace(
            /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi,
            "[redacted connection URL]",
          )
          .replace(
            /access_token=[^&\s"'<>]+/gi,
            "access_token=[redacted]",
          );

        diagnostic("livekit_connect_failed", detail);
        console.error("LiveKit connection failed:", detail);

        throw error;
      }

      if (room !== activeRoom) return;

      diagnostic("room_connected");

      try {
        await activeRoom.startAudio();
      } catch {
        diagnostic(
          "audio_playback_blocked",
          "Click Enable speaker audio",
        );
      }

      if (room !== activeRoom) return;

      await activeRoom.localParticipant.setMicrophoneEnabled(true);

      if (room !== activeRoom) {
        await activeRoom.disconnect();
        return;
      }

      diagnostic("microphone_published");
      state("Connected", "connected");

      ui["microphone-status"].textContent = "On";
      ui.mute.textContent = "Mute microphone";
      ui.mute.disabled = false;
      ui.end.disabled = false;

      audioState(activeRoom);

      ui["session-message"].textContent =
        "Microphone is live. Speak naturally when the agent joins. " +
        "Interrupt while it speaks to test barge-in.";

      ui["session-limit"].textContent =
        "Ends at " + new Date(session.expiresAt).toLocaleTimeString();

      if (activeRoom.remoteParticipants.size) {
        ui["agent-status"].textContent = "Remote participant present";
      } else {
        agentTimer = setTimeout(() => {
          if (
            room === activeRoom &&
            !activeRoom.remoteParticipants.size
          ) {
            ui["agent-status"].textContent =
              "Still waiting: check worker terminal and agent name";

            diagnostic(
              "worker_join_wait",
              "No remote participant after 20 seconds",
            );
          }
        }, 20000);
      }

      expiryTimer = setTimeout(
        () => void endSession(
          "The 10-minute test session limit was reached.",
        ),
        Math.max(0, Date.parse(session.expiresAt) - Date.now()),
      );

      busy = false;
    } catch (error) {
      // An obsolete attempt must not tear down a newer session.
      if (attempt !== generation) return;

      const message = error.name === "NotAllowedError"
        ? "Microphone access was denied. Allow access in your browser and retry."
        : "Could not start the voice test. Check the local service and worker " +
          "terminals, LiveKit configuration, and browser microphone permissions.";

      diagnostic("session_start_failed", error.name || "Error");

      await endSession(message);
      state("Unable to connect", "failed");
    }
  });

  ui.mute.addEventListener("click", async () => {
    const activeRoom = room;
    if (!activeRoom) return;

    ui.mute.disabled = true;

    try {
      const enabled =
        !activeRoom.localParticipant.isMicrophoneEnabled;

      await activeRoom.localParticipant.setMicrophoneEnabled(enabled);

      if (room !== activeRoom) {
        await activeRoom.disconnect();
        return;
      }

      ui.mute.textContent = enabled
        ? "Mute microphone"
        : "Unmute microphone";

      ui["microphone-status"].textContent = enabled ? "On" : "Muted";

      diagnostic(
        enabled ? "microphone_unmuted" : "microphone_muted",
      );
    } catch {
      diagnostic("microphone_toggle_failed");
    } finally {
      ui.mute.disabled = !room;
    }
  });

  ui.audio.addEventListener("click", async () => {
    const activeRoom = room;
    if (!activeRoom) return;

    try {
      await activeRoom.startAudio();

      if (room === activeRoom) {
        audioState(activeRoom);
        diagnostic("audio_playback_unlocked");
      }
    } catch {
      diagnostic("audio_playback_unlock_failed");
    }
  });

  ui.end.addEventListener("click", () => void endSession());

  ui["clear-transcript"].addEventListener("click", () => {
    ui.transcript.replaceChildren();
    segments.clear();
  });

  ui.download.addEventListener("click", () => {
    const log = {
      kind: "browser_diagnostics",
      endpointLatencyMeasured: false,
      events,
    };

    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify(log, null, 2)],
        { type: "application/json" },
      ),
    );

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "india-voice-browser-diagnostics.json";
    anchor.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  window.addEventListener("pagehide", () => {
    room?.disconnect();

    if (sessionHandle) {
      navigator.sendBeacon(
        "/session/end",
        new Blob(
          [JSON.stringify({ sessionHandle })],
          { type: "application/json" },
        ),
      );
    }
  });

  diagnostic(
    "page_ready",
    "No voice latency measurement is inferred from browser events",
  );
})();
