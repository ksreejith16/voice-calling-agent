import AgentWorkspace from '../../../../../components/agent-workspace';
import { apiFetch, getMe } from '../../../../../lib/api';
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent, me] = await Promise.all([apiFetch<Parameters<typeof AgentWorkspace>[0]['agent']>('/agents/' + id), getMe()]);
  return <AgentWorkspace key={id} agent={agent} role={me.role ?? 'viewer'} />;
}
