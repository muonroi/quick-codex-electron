import { EventEmitter } from "node:events";

import { createQuickCodexHostApi, defaultQuickCodexHostApi } from "quick-codex/host-api";

function clip(value, max = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function normalizeMode(value) {
  // `orchestrated` remains as an internal compatibility seam for tests and
  // migration coverage. The public Electron host UI now exposes passthrough
  // only and treats it as the main native Codex + QC automation surface.
  return value === "orchestrated" ? "orchestrated" : "passthrough";
}

export class ElectronSessionManager extends EventEmitter {
  constructor({
    hostApi = defaultQuickCodexHostApi
  } = {}) {
    super();
    this.hostApi = hostApi === defaultQuickCodexHostApi
      ? defaultQuickCodexHostApi
      : createQuickCodexHostApi(hostApi);
    this.session = null;
    this.observer = null;
    this.mode = "passthrough";
    this.dir = process.cwd();
    this.maxTurns = 5;
    this.policy = null;
    this.wrapperConfig = null;
    this.currentModel = null;
    this.currentReasoningEffort = null;
    this.pendingTask = false;
    this.lastDecision = null;
    this.lastRouteTask = null;
  }

  snapshot() {
    return {
      mode: this.mode,
      dir: this.dir,
      maxTurns: this.maxTurns,
      started: Boolean(this.session),
      pendingTask: this.pendingTask,
      model: this.currentModel,
      reasoningEffort: this.currentReasoningEffort,
      policy: this.policy,
      observer: this.observer?.toJSON().snapshot ?? null,
      lastDecision: this.lastDecision,
      lastRouteTask: this.lastRouteTask
    };
  }

  async startSession({ mode = "passthrough", dir, maxTurns = 5, cols = null, rows = null } = {}) {
    await this.stopSession();

    this.mode = normalizeMode(mode);
    this.dir = dir ?? this.dir;
    this.maxTurns = maxTurns;
    this.wrapperConfig = this.hostApi.loadWrapperConfig(this.dir);
    this.policy = this.hostApi.resolvePermissionPolicy({ wrapperConfig: this.wrapperConfig });
    this.observer = this.hostApi.createNativeSessionObserver();
    this.observer.on("event", (event) => {
      this.emit("session-event", {
        type: "observer",
        event
      });
    });

    this.session = this.hostApi.createNativeSession({
      dir: this.dir,
      policy: this.policy,
      stdioMode: "pty",
      forwardOutput: false,
      observer: this.observer,
      cols,
      rows,
      onOutputChunk: (chunk, meta) => {
        this.emit("output", {
          chunk,
          source: meta?.source ?? "pty-output"
        });
      }
    });

    await this.session.start({
      onProgress: (entry) => {
        this.emit("session-event", {
          type: "progress",
          entry
        });
      }
    });

    this.currentModel = null;
    this.currentReasoningEffort = null;
    this.lastDecision = null;
    this.lastRouteTask = null;

    const payload = this.snapshot();
    this.emit("started", payload);
    this.emit("status", payload);
    return payload;
  }

  async stopSession() {
    if (!this.session) {
      return;
    }
    await this.session.stop();
    this.session = null;
    this.observer = null;
    this.pendingTask = false;
    this.emit("stopped", this.snapshot());
  }

  resize(cols, rows) {
    if (!this.session) {
      return false;
    }
    const nextCols = Math.max(20, Math.min(400, Number(cols || 120)));
    const nextRows = Math.max(10, Math.min(200, Number(rows || 40)));
    return this.session.resize(nextCols, nextRows);
  }

  async writeRaw(text) {
    if (!this.session?.controller?.isControllable()) {
      throw new Error("No controllable native session is active.");
    }
    this.session.controller.sendRaw(String(text ?? ""));
  }

  async slash(command) {
    if (!this.session) {
      throw new Error("No native session is active.");
    }
    const result = await this.session.slash(command, {
      onProgress: (entry) => {
        this.emit("session-event", {
          type: "progress",
          entry
        });
      }
    });
    this.emit("session-event", {
      type: "slash-result",
      result
    });
    return result;
  }

  async submitTask(task) {
    if (this.mode !== "orchestrated") {
      throw new Error("submitTask is only available in orchestrated mode.");
    }
    return this.#submitManagedTask(task, { source: "orchestrated-taskbox" });
  }

  async submitInterceptedTask(task) {
    if (this.mode !== "passthrough") {
      throw new Error("submitInterceptedTask is only available in passthrough mode.");
    }
    return this.#submitManagedTask(task, { source: "passthrough-intercept" });
  }

  async #submitManagedTask(task, { source = "managed-submit" } = {}) {
    if (!this.session) {
      await this.startSession({
        mode: this.mode,
        dir: this.dir,
        maxTurns: this.maxTurns
      });
    }

    const routed = await this.#buildTaskDecision(task);
    this.lastDecision = routed.decision;
    this.lastRouteTask = routed.taskRoute;
    this.emit("session-event", {
      type: "task-route",
      source,
      task: clip(task),
      route: routed.decision.route,
      routeSource: routed.decision.routeSource,
      reason: routed.decision.reason,
      activeRun: routed.decision.activeRun ?? null,
      activeLock: routed.decision.activeLock ?? null,
      promptSource: routed.decision.promptSource,
      protocolEnforced: routed.decision.protocolEnforced ?? false,
      protocolName: routed.decision.protocolName ?? null,
      protocolGate: routed.decision.protocolGate ?? null,
      protocolArtifactRun: routed.decision.protocolArtifactRun ?? null,
      protocolHandoffArtifactRun: routed.decision.protocolHandoffArtifactRun ?? null
    });

    if (routed.modelRoute?.applied) {
      this.emit("session-event", {
        type: "model-route",
        model: routed.modelRoute.model,
        reasoningEffort: routed.modelRoute.reasoningEffort ?? null,
        source: routed.modelRoute.source ?? null,
        reason: routed.modelRoute.reason ?? null
      });
    }

    await this.#ensureSessionModel({
      model: routed.decision.model,
      reasoningEffort: routed.decision.reasoningEffort
    });

    this.pendingTask = true;
    this.emit("status", this.snapshot());
    const result = await this.session.task(routed.decision.prompt, {
      onProgress: (entry) => {
        this.emit("session-event", {
          type: "progress",
          entry
        });
      }
    });
    this.pendingTask = false;
    this.emit("session-event", {
      type: "task-result",
      result,
      source,
      route: routed.decision.route,
      model: routed.decision.model ?? "default"
    });
    const continuation = this.#resolveAutoFollow({
      previousArtifact: routed.activeArtifact?.artifact ?? null,
      state: routed.wrapperState
    });
    this.emit("session-event", {
      type: "follow-loop-decision",
      ...continuation.event
    });
    const autoFollow = await this.#executeAutoFollow({
      continuation,
      state: routed.wrapperState
    });
    this.emit("status", this.snapshot());
    return {
      routed: routed.decision,
      modelRoute: routed.modelRoute,
      result,
      continuation: continuation.event,
      follow: autoFollow
    };
  }

  async #buildTaskDecision(task) {
    const normalizedTask = String(task ?? "").trim();
    if (!normalizedTask) {
      throw new Error("Task text is required.");
    }

    const wrapperState = this.hostApi.loadWrapperState(this.dir);
    const localRoute = this.hostApi.routeTask({ task: normalizedTask });
    const activeArtifact = this.hostApi.readActiveRunArtifact(this.dir);
    const activeLockArtifact = this.hostApi.readActiveLockArtifact
      ? this.hostApi.readActiveLockArtifact(this.dir)
      : null;
    const activeRunPreference = this.hostApi.inspectActiveRunPreference({
      dir: this.dir,
      task: normalizedTask,
      initialRoute: localRoute.route,
      wrapperState
    });
    const taskRoute = await this.hostApi.resolveExperienceTaskRoute({
      dir: this.dir,
      task: normalizedTask,
      localRoute,
      activeArtifact: activeArtifact?.artifact ?? null,
      activeRunPreference
    });

    if (taskRoute.needsDisambiguation) {
      this.emit("session-event", {
        type: "task-disambiguation",
        task: clip(normalizedTask),
        reason: taskRoute.reason ?? "Task routing requires clarification.",
        options: taskRoute.options ?? []
      });
      throw new Error("Task routing requires disambiguation before submission.");
    }

    const route = taskRoute.applied && taskRoute.route
      ? taskRoute.route
      : activeRunPreference?.route
        ? activeRunPreference.route
        : localRoute.route;
    const routeSource = taskRoute.applied && taskRoute.route
      ? taskRoute.source ?? "experience-task-router"
      : activeRunPreference?.route
        ? "active-run"
        : "heuristic-fallback";
    const reason = taskRoute.applied && taskRoute.route
      ? (taskRoute.reason ?? localRoute.reason)
      : activeRunPreference?.reason
        ? activeRunPreference.reason
        : localRoute.reason;

    const projectState = this.hostApi.ensureProjectBootstrap({
      dir: this.dir,
      route,
      dryRun: false
    });
    let protocol = null;
    let prompt = activeRunPreference?.route
      ? activeRunPreference.prompt
      : this.hostApi.compileTaskPrompt({
          route,
          task: normalizedTask,
          reason,
          projectState
        });

    if (route === "qc-flow" && this.hostApi.enforceQcFlowProtocol) {
      protocol = this.hostApi.enforceQcFlowProtocol({
        dir: this.dir,
        task: normalizedTask,
        executionMode: this.maxTurns > 1 ? "auto" : "manual",
        activeArtifact: activeRunPreference ? activeArtifact?.artifact ?? null : null
      });
      prompt = protocol.prompt;
    } else if (route === "qc-lock" && this.hostApi.enforceQcLockProtocol) {
      protocol = this.hostApi.enforceQcLockProtocol({
        dir: this.dir,
        task: normalizedTask,
        executionMode: this.maxTurns > 1 ? "auto" : "manual",
        activeLockArtifact: activeLockArtifact?.artifact ?? null,
        activeFlowArtifact: activeArtifact?.artifact ?? null
      });
      prompt = protocol.prompt;
    }

    const decision = {
      task: normalizedTask,
      route,
      routeSource,
      reason,
      prompt,
      promptSource: protocol
        ? (protocol.created
            ? (route === "qc-lock" ? "qc-lock-protocol-bootstrap" : "qc-flow-protocol-bootstrap")
            : (route === "qc-lock" ? "qc-lock-protocol" : "qc-flow-protocol"))
        : activeRunPreference?.route ? "active-run" : "task-router",
      activeRun: route === "qc-lock"
        ? activeArtifact?.artifact?.relativeRunPath ?? activeRunPreference?.activeRun ?? null
        : protocol?.artifact.relativeRunPath ?? activeRunPreference?.activeRun ?? null,
      activeLock: route === "qc-lock"
        ? protocol?.artifact.relativeRunPath ?? activeLockArtifact?.artifact?.relativeRunPath ?? null
        : activeLockArtifact?.artifact?.relativeRunPath ?? null,
      currentGate: protocol?.effectiveGate ?? activeRunPreference?.activeRunGate ?? null,
      protocolEnforced: Boolean(protocol),
      protocolGate: protocol?.effectiveGate ?? null,
      protocolArtifactRun: protocol?.artifact.relativeRunPath ?? null,
      protocolName: protocol ? route : null,
      protocolHandoffArtifactRun: protocol?.handoffArtifactRun ?? null,
      model: null,
      reasoningEffort: null
    };

    const modelRoute = await this.hostApi.resolveExperienceModelRoute({
      dir: this.dir,
      task: normalizedTask,
      artifact: activeArtifact?.artifact ?? null,
      decision
    });
    if (modelRoute.applied) {
      decision.model = modelRoute.model ?? null;
      decision.reasoningEffort = modelRoute.reasoningEffort ?? null;
    }

    return {
      decision,
      activeArtifact,
      wrapperState,
      taskRoute,
      modelRoute
    };
  }

  #resolveAutoFollow({ previousArtifact = null, state }) {
    const continuation = this.hostApi.resolveAutoContinuation({
      dir: this.dir,
      state
    });
    const stop = this.hostApi.classifyAutoFollowStop({
      previousArtifact,
      artifact: continuation.artifact,
      flowState: continuation.flowState,
      decision: continuation.decision
    });
    const checkpointSummary = continuation.artifact && continuation.decision
      ? this.hostApi.buildCheckpointSummary({
          artifact: continuation.artifact,
          decision: continuation.decision,
          state
        })
      : null;

    const event = {
      shouldStop: stop.shouldStop,
      stopReason: stop.stopReason,
      checkpointAdvanced: stop.checkpointAdvanced,
      flowStatus: continuation.flowState?.status ?? null,
      flowGate: continuation.flowState?.currentGate ?? null,
      artifactRun: continuation.artifact?.relativeRunPath ?? null,
      currentGate: continuation.artifact?.currentGate ?? continuation.flowState?.currentGate ?? null,
      currentPhaseWave: continuation.artifact?.currentPhaseWave ?? continuation.flowState?.currentPhaseWave ?? null,
      handoffAction: continuation.decision?.handoffAction ?? null,
      phaseRelation: continuation.decision?.phaseRelation ?? null,
      nativeThreadAction: continuation.decision?.nativeThreadAction ?? null,
      continuePrompt: continuation.decision?.prompt ?? null,
      checkpointSummary
    };

    return {
      ...continuation,
      stop,
      checkpointSummary,
      event
    };
  }

  async #executeAutoFollow({ continuation, state }) {
    let turnsExecuted = 1;
    let latest = continuation;

    while (!latest.stop.shouldStop && turnsExecuted < this.maxTurns) {
      const slashCommand = this.#mapDecisionToSlash(latest.decision);
      this.emit("session-event", {
        type: "follow-loop-action",
        turn: turnsExecuted + 1,
        slashCommand,
        handoffAction: latest.decision?.handoffAction ?? null,
        continuePrompt: latest.decision?.prompt ?? null,
        run: latest.artifact?.relativeRunPath ?? null
      });

      if (slashCommand) {
        const slashResult = await this.session.slash(slashCommand, {
          onProgress: (entry) => {
            this.emit("session-event", {
              type: "progress",
              entry
            });
          }
        });
        this.emit("session-event", {
          type: "slash-result",
          result: slashResult,
          source: "follow-loop"
        });
      }

      const result = await this.session.task(latest.decision.prompt, {
        onProgress: (entry) => {
          this.emit("session-event", {
            type: "progress",
            entry
          });
        }
      });
      turnsExecuted += 1;
      this.emit("session-event", {
        type: "task-result",
        result,
        route: "artifact",
        model: this.currentModel ?? "default",
        source: "follow-loop"
      });

      latest = this.#resolveAutoFollow({
        previousArtifact: latest.artifact ?? null,
        state
      });
      this.emit("session-event", {
        type: "follow-loop-decision",
        ...latest.event
      });
    }

    const stoppedBecause = latest.stop.shouldStop
      ? latest.stop.stopReason
      : "max-turns-reached";
    const summary = {
      turnsExecuted,
      stoppedBecause,
      lastDecision: latest.event
    };
    this.emit("session-event", {
      type: "follow-loop-finished",
      ...summary
    });
    return summary;
  }

  #mapDecisionToSlash(decision) {
    const action = decision?.handoffAction ?? null;
    if (action === "clear-session") return "/clear";
    if (action === "compact-session") return "/compact";
    if (action === "resume-session") return "/resume --last";
    return null;
  }

  async #ensureSessionModel({ model = null, reasoningEffort = null }) {
    const nextModel = model ?? null;
    const nextReasoning = reasoningEffort ?? null;
    if (!this.session) {
      throw new Error("No native session is active.");
    }
    if (this.currentModel === nextModel && this.currentReasoningEffort === nextReasoning) {
      return;
    }

    await this.session.stop();
    this.observer = this.hostApi.createNativeSessionObserver();
    this.observer.on("event", (event) => {
      this.emit("session-event", {
        type: "observer",
        event
      });
    });
    this.session = this.hostApi.createNativeSession({
      dir: this.dir,
      policy: this.policy,
      model: nextModel,
      reasoningEffort: nextReasoning,
      stdioMode: "pty",
      forwardOutput: false,
      observer: this.observer,
      onOutputChunk: (chunk, meta) => {
        this.emit("output", {
          chunk,
          source: meta?.source ?? "pty-output"
        });
      }
    });
    await this.session.start({
      onProgress: (entry) => {
        this.emit("session-event", {
          type: "progress",
          entry
        });
      }
    });

    this.currentModel = nextModel;
    this.currentReasoningEffort = nextReasoning;
    this.emit("session-event", {
      type: "session-model-ready",
      model: this.currentModel ?? "default",
      reasoningEffort: this.currentReasoningEffort ?? "default"
    });
  }
}
