import type { ChatSessionInfo } from './types';

export type OrderedChatSession = {
  session: ChatSessionInfo;
  depth: number;
};

type NavigationNode = {
  session: ChatSessionInfo;
  index: number;
  children: NavigationNode[];
  parent?: NavigationNode;
  latest?: NavigationNode;
};

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Returns a positive value when `left` is more recent than `right`.
 */
export function compareSessionRecency(left: ChatSessionInfo, right: ChatSessionInfo): number {
  const leftUpdatedAt = finiteTimestamp(left.updatedAt);
  const rightUpdatedAt = finiteTimestamp(right.updatedAt);
  if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt > rightUpdatedAt ? 1 : -1;

  const leftCreatedAt = finiteTimestamp(left.createdAt);
  const rightCreatedAt = finiteTimestamp(right.createdAt);
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt > rightCreatedAt ? 1 : -1;
  return 0;
}

function compareNodeRecency(left: NavigationNode, right: NavigationNode): number {
  const timestampOrder = compareSessionRecency(left.session, right.session);
  if (timestampOrder !== 0) return timestampOrder;
  if (left.index === right.index) return 0;
  return left.index > right.index ? 1 : -1;
}

function wouldCreateCycle(
  node: NavigationNode,
  parent: NavigationNode,
  nodesById: Map<string, NavigationNode>
): boolean {
  const seen = new Set<string>([node.session.id]);
  let current: NavigationNode | undefined = parent;
  while (current) {
    if (seen.has(current.session.id)) return true;
    seen.add(current.session.id);
    const parentId: string | undefined = current.session.parentSessionId;
    current = parentId ? nodesById.get(parentId) : undefined;
  }
  return false;
}

function updateLatestDescendant(node: NavigationNode): NavigationNode {
  let latest = node;
  for (const child of node.children) {
    const childLatest = updateLatestDescendant(child);
    if (compareNodeRecency(childLatest, latest) > 0) latest = childLatest;
  }
  node.latest = latest;
  return latest;
}

function compareGroupsMostRecentFirst(left: NavigationNode, right: NavigationNode): number {
  return compareNodeRecency(right.latest ?? right, left.latest ?? left);
}

export function orderSessionsForNavigation(
  sessions: Iterable<ChatSessionInfo>,
  activeSessionId: string
): OrderedChatSession[] {
  const nodes: NavigationNode[] = [];
  const nodesById = new Map<string, NavigationNode>();
  let index = 0;

  for (const session of sessions) {
    const node: NavigationNode = {
      session,
      index,
      children: [],
    };
    nodes.push(node);
    nodesById.set(session.id, node);
    index++;
  }

  const roots: NavigationNode[] = [];
  for (const node of nodes) {
    const parentId = node.session.parentSessionId;
    const parent = parentId ? nodesById.get(parentId) : undefined;
    if (!parent || parent === node || wouldCreateCycle(node, parent, nodesById)) {
      roots.push(node);
      continue;
    }
    node.parent = parent;
    parent.children.push(node);
  }

  for (const root of roots) updateLatestDescendant(root);

  const activePath = new Set<NavigationNode>();
  let activeRoot: NavigationNode | undefined;
  let activeNode = nodesById.get(activeSessionId);
  while (activeNode) {
    activePath.add(activeNode);
    activeRoot = activeNode;
    activeNode = activeNode.parent;
  }

  roots.sort((left, right) => {
    if (left === activeRoot) return -1;
    if (right === activeRoot) return 1;
    return compareGroupsMostRecentFirst(left, right);
  });

  const ordered: OrderedChatSession[] = [];
  const appendGroup = (node: NavigationNode, depth: number): void => {
    ordered.push({ session: node.session, depth });
    node.children.sort((left, right) => {
      const leftIsActivePath = activePath.has(left);
      const rightIsActivePath = activePath.has(right);
      if (leftIsActivePath !== rightIsActivePath) return leftIsActivePath ? -1 : 1;
      return compareGroupsMostRecentFirst(left, right);
    });
    for (const child of node.children) appendGroup(child, depth + 1);
  };

  for (const root of roots) appendGroup(root, 0);
  return ordered;
}
