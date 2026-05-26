(function (globalScope) {
  "use strict";

  var DEFAULT_TRANSITION_MS = 180;

  function normalizeStates(states) {
    if (!Array.isArray(states)) {
      return [];
    }
    var normalized = [];
    for (var index = 0; index < states.length; index += 1) {
      var candidate = states[index];
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      var url = candidate.url;
      if (typeof url !== "string" || url.length === 0) {
        continue;
      }
      normalized.push(candidate);
    }
    return normalized;
  }

  function readLatestSequence(states) {
    if (!Array.isArray(states) || states.length === 0) {
      return 0;
    }
    var latest = states[states.length - 1];
    var value = Number(latest && latest.sequence);
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    return Math.trunc(value);
  }

  function clampIndex(index, stateCount) {
    if (!Number.isFinite(index) || stateCount <= 0) {
      return null;
    }
    var integer = Math.trunc(index);
    if (integer < 0) {
      return 0;
    }
    if (integer >= stateCount) {
      return stateCount - 1;
    }
    return integer;
  }

  function computeSelection(input) {
    var states = normalizeStates(input && input.states);
    var latestSequence = readLatestSequence(states);
    var stateCount = states.length;
    if (stateCount === 0) {
      return {
        selectedIndex: null,
        latestSequence: 0,
        stateCount: 0,
        autoAdvanced: false,
      };
    }

    var previousLatest = Number(input && input.latestSequence);
    if (!Number.isFinite(previousLatest) || previousLatest < 0) {
      previousLatest = 0;
    }
    var previousIndex = input ? input.selectedIndex : null;
    var newerStateObserved = latestSequence > Math.trunc(previousLatest);

    var selectedIndex;
    if (newerStateObserved || previousIndex === null || previousIndex === undefined) {
      selectedIndex = stateCount - 1;
    } else {
      selectedIndex = clampIndex(Number(previousIndex), stateCount);
      if (selectedIndex === null) {
        selectedIndex = stateCount - 1;
      }
    }

    return {
      selectedIndex: selectedIndex,
      latestSequence: latestSequence,
      stateCount: stateCount,
      autoAdvanced: newerStateObserved,
    };
  }

  function navigateSelection(action, selectedIndex, stateCount) {
    if (!Number.isInteger(stateCount) || stateCount <= 0) {
      return null;
    }
    var current =
      selectedIndex === null || selectedIndex === undefined
        ? stateCount - 1
        : clampIndex(Number(selectedIndex), stateCount);
    if (current === null) {
      current = stateCount - 1;
    }

    if (action === "prev") {
      return clampIndex(current - 1, stateCount);
    }
    if (action === "next") {
      return clampIndex(current + 1, stateCount);
    }
    if (action === "home") {
      return 0;
    }
    if (action === "end") {
      return stateCount - 1;
    }
    return current;
  }

  function transitionDurationMs(reducedMotion) {
    return reducedMotion ? 0 : DEFAULT_TRANSITION_MS;
  }

  function prefersReducedMotion(win) {
    if (!win || typeof win.matchMedia !== "function") {
      return false;
    }
    try {
      return !!win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_error) {
      return false;
    }
  }

  function parseSandboxProfile(win) {
    if (!win || !win.location || typeof win.location.search !== "string") {
      return "default";
    }
    try {
      var params = new URLSearchParams(win.location.search);
      var value = params.get("sandbox");
      return value === "strict" ? "strict" : "default";
    } catch (_error) {
      return "default";
    }
  }

  function sandboxTokensForProfile(root, profile) {
    if (!root || !root.dataset) {
      return "allow-scripts allow-same-origin";
    }
    if (profile === "strict") {
      return root.dataset.sandboxStrict || "allow-scripts";
    }
    return root.dataset.sandboxDefault || "allow-scripts allow-same-origin";
  }

  function applyIframeSandbox(controller) {
    var profile = parseSandboxProfile(controller.window);
    var tokens = sandboxTokensForProfile(controller.root, profile);
    controller.root.dataset.sandboxProfile = profile;
    controller.frames.forEach(function (frame) {
      frame.setAttribute("sandbox", tokens);
    });
  }

  function keyToNavigationAction(key) {
    if (key === "ArrowLeft") {
      return "prev";
    }
    if (key === "ArrowRight") {
      return "next";
    }
    if (key === "Home") {
      return "home";
    }
    if (key === "End") {
      return "end";
    }
    return null;
  }

  function createViewerController(root, win) {
    var documentRef = root.ownerDocument;
    var statusEl = documentRef.getElementById("viewer-status");
    var emptyEl = documentRef.getElementById("viewer-empty");
    var frameA = documentRef.getElementById("viewer-frame-a");
    var frameB = documentRef.getElementById("viewer-frame-b");
    if (!statusEl || !emptyEl || !frameA || !frameB) {
      return null;
    }

    var controller = {
      root: root,
      window: win,
      statusEl: statusEl,
      emptyEl: emptyEl,
      frames: [frameA, frameB],
      activeFrameIndex: 0,
      pendingLoadId: 0,
      selectedIndex: null,
      latestSequence: 0,
      states: [],
      currentStateId: null,
      reducedMotion: prefersReducedMotion(win),
      transitionMs: DEFAULT_TRANSITION_MS,
    };
    controller.transitionMs = transitionDurationMs(controller.reducedMotion);
    root.dataset.reducedMotion = controller.reducedMotion ? "true" : "false";
    applyIframeSandbox(controller);
    return controller;
  }

  function updateStatus(controller) {
    var stateCount = controller.states.length;
    if (stateCount === 0 || controller.selectedIndex === null) {
      controller.statusEl.textContent = "No states";
      return;
    }
    var state = controller.states[controller.selectedIndex];
    var stateId = state && typeof state.state_id === "string" ? state.state_id : "unknown";
    controller.statusEl.textContent =
      "State " +
      String(controller.selectedIndex + 1) +
      "/" +
      String(stateCount) +
      " - " +
      stateId;
  }

  function updateControls(controller) {
    var buttons = controller.root.querySelectorAll("[data-action]");
    var count = controller.states.length;
    var selected = controller.selectedIndex;
    var atStart = selected === null || selected <= 0;
    var atEnd = selected === null || selected >= count - 1;
    buttons.forEach(function (button) {
      var action = button.getAttribute("data-action");
      if (!action || count === 0) {
        button.disabled = true;
        return;
      }
      if (action === "home" || action === "prev") {
        button.disabled = atStart;
        return;
      }
      if (action === "next" || action === "end") {
        button.disabled = atEnd;
        return;
      }
      button.disabled = false;
    });
  }

  function swapToSelectedState(controller) {
    if (controller.selectedIndex === null) {
      controller.emptyEl.style.display = "block";
      updateStatus(controller);
      updateControls(controller);
      return;
    }
    var state = controller.states[controller.selectedIndex];
    if (!state || typeof state.url !== "string" || state.url.length === 0) {
      controller.emptyEl.style.display = "block";
      updateStatus(controller);
      updateControls(controller);
      return;
    }
    controller.emptyEl.style.display = "none";

    var stateId = typeof state.state_id === "string" ? state.state_id : null;
    if (controller.currentStateId && stateId && controller.currentStateId === stateId) {
      updateStatus(controller);
      updateControls(controller);
      return;
    }

    var activeIndex = controller.activeFrameIndex;
    var inactiveIndex = activeIndex === 0 ? 1 : 0;
    var activeFrame = controller.frames[activeIndex];
    var nextFrame = controller.frames[inactiveIndex];
    var loadId = controller.pendingLoadId + 1;
    controller.pendingLoadId = loadId;

    nextFrame.onload = function () {
      if (controller.pendingLoadId !== loadId) {
        return;
      }
      nextFrame.classList.add("is-active");
      activeFrame.classList.remove("is-active");
      controller.activeFrameIndex = inactiveIndex;
      controller.currentStateId = stateId;
      updateStatus(controller);
      updateControls(controller);
    };
    nextFrame.src = state.url;
  }

  function applyManifest(controller, manifestStates) {
    var nextStates = normalizeStates(manifestStates);
    var selection = computeSelection({
      states: nextStates,
      selectedIndex: controller.selectedIndex,
      latestSequence: controller.latestSequence,
    });
    controller.states = nextStates;
    controller.selectedIndex = selection.selectedIndex;
    controller.latestSequence = selection.latestSequence;
    if (controller.selectedIndex === null) {
      controller.currentStateId = null;
    }
    swapToSelectedState(controller);
  }

  function navigate(controller, action) {
    controller.selectedIndex = navigateSelection(
      action,
      controller.selectedIndex,
      controller.states.length
    );
    swapToSelectedState(controller);
  }

  function isEditableTarget(target) {
    if (!target || typeof target !== "object") {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    var tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
    return tagName === "input" || tagName === "textarea" || tagName === "select";
  }

  function installReducedMotionListener(controller) {
    if (!controller.window || typeof controller.window.matchMedia !== "function") {
      return;
    }
    var mediaQuery;
    try {
      mediaQuery = controller.window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch (_error) {
      return;
    }
    var applyMode = function (reduced) {
      controller.reducedMotion = !!reduced;
      controller.transitionMs = transitionDurationMs(controller.reducedMotion);
      controller.root.dataset.reducedMotion = controller.reducedMotion ? "true" : "false";
    };
    applyMode(mediaQuery.matches);
    var onChange = function (event) {
      applyMode(!!event.matches);
    };
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return;
    }
    if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(onChange);
    }
  }

  function bootViewer() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    var root = document.getElementById("viewer-root");
    if (!root) {
      return;
    }
    var manifestUrl = root.dataset.manifestUrl;
    var eventsUrl = root.dataset.eventsUrl;
    if (!manifestUrl) {
      return;
    }
    var controller = createViewerController(root, window);
    if (!controller) {
      return;
    }

    function refreshManifest() {
      fetch(manifestUrl, { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("manifest request failed: " + String(response.status));
          }
          return response.json();
        })
        .then(function (manifest) {
          applyManifest(controller, manifest && manifest.states);
        })
        .catch(function (error) {
          controller.statusEl.textContent = "Viewer error: " + String(error.message || error);
        });
    }

    root.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.getAttribute("data-action");
        if (!action) {
          return;
        }
        navigate(controller, action);
      });
    });

    window.addEventListener("keydown", function (event) {
      if (isEditableTarget(event.target)) {
        return;
      }
      var action = keyToNavigationAction(event.key);
      if (action) {
        navigate(controller, action);
        event.preventDefault();
      }
    });

    installReducedMotionListener(controller);
    refreshManifest();

    if (eventsUrl && typeof window.EventSource === "function") {
      var source = new window.EventSource(eventsUrl);
      source.addEventListener("state-added", refreshManifest);
      source.addEventListener("sync", refreshManifest);
      source.addEventListener("hello", refreshManifest);
      source.onerror = function () {
        if (source.readyState === window.EventSource.CLOSED) {
          controller.statusEl.textContent = "Disconnected";
        }
      };
    }
  }

  var viewerShellApi = {
    DEFAULT_TRANSITION_MS: DEFAULT_TRANSITION_MS,
    clampIndex: clampIndex,
    computeSelection: computeSelection,
    navigateSelection: navigateSelection,
    transitionDurationMs: transitionDurationMs,
    prefersReducedMotion: prefersReducedMotion,
    keyToNavigationAction: keyToNavigationAction,
    parseSandboxProfile: parseSandboxProfile,
    sandboxTokensForProfile: sandboxTokensForProfile,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = viewerShellApi;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootViewer);
    } else {
      bootViewer();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
