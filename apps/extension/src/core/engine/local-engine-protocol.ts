// Compatibility shim for extension imports. The canonical protocol types live
// in packages/protocol so browser and non-browser clients share one source.
export type {
  EngineHealthResponse,
  LocalEngineClientMessage,
  LocalEngineServerMessage,
} from '../../../../../packages/protocol/src/local-engine';
export { LOCAL_ENGINE_PROTOCOL_VERSION } from '../../../../../packages/protocol/src/local-engine';
