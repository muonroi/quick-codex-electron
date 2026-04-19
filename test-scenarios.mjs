import { ElectronSessionManager } from "./session-manager.mjs";

class ScenarioNativeSession {
  constructor(options) {
    this.options = options;
    this.started = false;
    this.stopped = false;
    this.tasks = [];
    this.slashCommands = [];
    this.rawWrites = [];
    this.resizeCalls = [];
    this.controller = {
      isControllable: () => true,
      sendRaw: (text) => {
        this.rawWrites.push(text);
      }
    };
  }

  async start({ onProgress } = {}) {
    this.started = true;
    this.options.onOutputChunk?.("BOOT", { source: "pty-output" });
    onProgress?.("scenario-native=start");
    return this;
  }

  async stop() {
    this.stopped = true;
  }

  async task(prompt, { onProgress } = {}) {
    this.tasks.push(prompt);
    onProgress?.(`scenario-native=task:${prompt}`);
    return { prompt };
  }

  async slash(command, { onProgress } = {}) {
    this.slashCommands.push(command);
    onProgress?.(`scenario-native=slash:${command}`);
    return { command };
  }

  resize(cols, rows) {
    this.resizeCalls.push({ cols, rows });
    return true;
  }
}

function makeContinuationSequence(items) {
  let index = 0;
  return () => {
    const next = items[Math.min(index, items.length - 1)];
    index += 1;
    return next;
  };
}

function makeScenarioWrapperApi({
  route = "qc-flow",
  reason = "scenario route",
  continuationSequence,
  ...overrides
}) {
  const nextContinuation = makeContinuationSequence(continuationSequence);

  return {
    createNativeSession: (options) => new ScenarioNativeSession(options),
    createNativeSessionObserver: () => ({
      on() {},
      toJSON() {
        return { snapshot: null };
      }
    }),
    compileTaskPrompt: ({ route: taskRoute, task }) => `PROMPT:${taskRoute}:${task}`,
    enforceQcFlowProtocol: null,
    enforceQcLockProtocol: null,
    buildCheckpointSummary: ({ artifact, decision }) => ({
      run: artifact.relativeRunPath,
      prompt: decision.prompt,
      summary: `Scenario checkpoint for ${artifact.relativeRunPath}`
    }),
    classifyAutoFollowStop: ({ previousArtifact, artifact }) => {
      const checkpointAdvanced = previousArtifact !== artifact;
      if (previousArtifact && !checkpointAdvanced) {
        return {
          shouldStop: true,
          stopReason: "no-checkpoint-progress",
          checkpointAdvanced: false
        };
      }
      return {
        shouldStop: false,
        stopReason: null,
        checkpointAdvanced
      };
    },
    ensureProjectBootstrap: ({ route: taskRoute }) => ({
      route: taskRoute,
      scaffoldPresent: true,
      bootstrapRequired: false
    }),
    inspectActiveRunPreference: () => null,
    loadWrapperConfig: () => ({
      defaults: {
        permissionProfile: "safe",
        approvalMode: null
      }
    }),
    loadWrapperState: () => ({ version: 1, runs: {} }),
    readActiveRunArtifact: () => ({
      artifact: {
        relativeRunPath: ".quick-codex-flow/passthrough-follow.md",
        currentGate: "execute",
        currentPhaseWave: "P1 / W1"
      }
    }),
    resolveAutoContinuation: () => nextContinuation(),
    resolveExperienceModelRoute: async () => ({ applied: false }),
    resolveExperienceTaskRoute: async () => ({
      enabled: false,
      applied: false,
      needsDisambiguation: false
    }),
    resolvePermissionPolicy: () => ({
      permissionProfile: "safe",
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
      bypassApprovalsAndSandbox: false
    }),
    routeTask: () => ({ route, reason }),
    ...overrides
  };
}

function buildScenarioArtifacts() {
  const compactAdvanced = {
    relativeRunPath: ".quick-codex-flow/passthrough-follow.md",
    currentGate: "execute",
    currentPhaseWave: "P1 / W2"
  };
  const resumeAdvanced = {
    relativeRunPath: ".quick-codex-flow/passthrough-resume.md",
    currentGate: "execute",
    currentPhaseWave: "P1 / W2"
  };
  const multiAdvancedOne = {
    relativeRunPath: ".quick-codex-flow/passthrough-invisible-chain.md",
    currentGate: "execute",
    currentPhaseWave: "P1 / W2"
  };
  const multiAdvancedTwo = {
    relativeRunPath: ".quick-codex-flow/passthrough-invisible-chain.md",
    currentGate: "execute",
    currentPhaseWave: "P1 / W3"
  };

  return {
    compactAdvanced,
    resumeAdvanced,
    multiAdvancedOne,
    multiAdvancedTwo
  };
}

const {
  compactAdvanced,
  resumeAdvanced,
  multiAdvancedOne,
  multiAdvancedTwo
} = buildScenarioArtifacts();

const scenarioDefinitions = {
  "passthrough-follow": {
    config: {
      scenario: "passthrough-follow",
      mode: "passthrough",
      maxTurns: 3,
      injectedInput: "review passthrough follow",
      quitOnFollowFinished: true
    },
    hostApi: makeScenarioWrapperApi({
      route: "direct",
      continuationSequence: [
        {
          flowState: {
            status: "active",
            currentGate: "execute",
            currentPhaseWave: "P1 / W1"
          },
          artifact: compactAdvanced,
          decision: {
            handoffAction: "compact-session",
            phaseRelation: "same-phase",
            nativeThreadAction: "thread/compact/start",
            prompt: "Continue after compact."
          }
        },
        {
          flowState: {
            status: "active",
            currentGate: "execute",
            currentPhaseWave: "P1 / W1"
          },
          artifact: compactAdvanced,
          decision: {
            handoffAction: "compact-session",
            phaseRelation: "same-phase",
            nativeThreadAction: "thread/compact/start",
            prompt: "Continue after compact."
          }
        }
      ]
    })
  },
  "passthrough-resume": {
    config: {
      scenario: "passthrough-resume",
      mode: "passthrough",
      maxTurns: 3,
      injectedInput: "plan passthrough resume",
      quitOnFollowFinished: true
    },
    hostApi: makeScenarioWrapperApi({
      continuationSequence: [
        {
          flowState: {
            status: "active",
            currentGate: "execute",
            currentPhaseWave: "P1 / W1"
          },
          artifact: resumeAdvanced,
          decision: {
            handoffAction: "resume-session",
            phaseRelation: "same-phase",
            nativeThreadAction: "thread/resume",
            prompt: "Continue after resume."
          }
        },
        {
          flowState: {
            status: "active",
            currentGate: "execute",
            currentPhaseWave: "P1 / W1"
          },
          artifact: resumeAdvanced,
          decision: {
            handoffAction: "resume-session",
            phaseRelation: "same-phase",
            nativeThreadAction: "thread/resume",
            prompt: "Continue after resume."
          }
        }
      ]
    })
  },
  "passthrough-invisible-chain": {
    config: {
      scenario: "passthrough-invisible-chain",
      mode: "passthrough",
      maxTurns: 4,
      injectedInput: "plan invisible automation chain",
      quitOnFollowFinished: true
    },
    hostApi: makeScenarioWrapperApi({
      continuationSequence: [
        {
          flowState: {
            status: "active",
            currentGate: "execute",
            currentPhaseWave: "P1 / W1"
          },
          artifact: multiAdvancedOne,
          decision: {
            handoffAction: "resume-session",
            phaseRelation: "same-phase",
            nativeThreadAction: "thread/resume",
            prompt: "Continue after resume."
          }
        },
        {
          flowState: {
            status: "active",
            currentGate: "execute",
            currentPhaseWave: "P1 / W2"
          },
          artifact: multiAdvancedTwo,
          decision: {
            handoffAction: "compact-session",
            phaseRelation: "same-phase",
            nativeThreadAction: "thread/compact/start",
            prompt: "Continue after compact."
          }
        },
        {
          flowState: {
            status: "active",
            currentGate: "execute",
            currentPhaseWave: "P1 / W2"
          },
          artifact: multiAdvancedTwo,
          decision: {
            handoffAction: "compact-session",
            phaseRelation: "same-phase",
            nativeThreadAction: "thread/compact/start",
            prompt: "Continue after compact."
          }
        }
      ]
    })
  }
};

export function resolveElectronTestScenario(name) {
  const definition = scenarioDefinitions[name];
  if (!definition) {
    return null;
  }
  return {
    config: definition.config,
    sessionManager: new ElectronSessionManager({
      hostApi: definition.hostApi
    })
  };
}
