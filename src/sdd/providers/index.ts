import { SddProvider, SddProviderMode } from '../../types';
import { AgentOsProvider } from './agentOsProvider';
import { GenericProvider } from './genericProvider';
import { SpecKitProvider } from './specKitProvider';

const PROVIDERS: Record<Exclude<SddProviderMode, 'auto'>, SddProvider> = {
  'spec-kit': new SpecKitProvider(),
  'agent-os': new AgentOsProvider(),
  'generic': new GenericProvider(),
};

export async function resolveSddProvider(mode: SddProviderMode, workspaceRoot: string): Promise<SddProvider> {
  if (mode !== 'auto') {
    return PROVIDERS[mode];
  }
  if (await PROVIDERS['spec-kit'].detect(workspaceRoot)) {
    return PROVIDERS['spec-kit'];
  }
  if (await PROVIDERS['agent-os'].detect(workspaceRoot)) {
    return PROVIDERS['agent-os'];
  }
  return PROVIDERS.generic;
}
