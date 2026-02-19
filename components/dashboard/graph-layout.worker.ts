export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

type WorkerLikeScope = {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage: (message: LayoutResponse, transfer: ArrayBuffer[]) => void;
};

const workerScope = self as unknown as WorkerLikeScope;

interface LayoutLink {
  source: string;
  target: string;
}

interface LayoutRequest {
  nodes: LayoutNode[];
  links: LayoutLink[];
  width: number;
  height: number;
  iterations?: number;
  frameBudgetMs?: number;
}

interface LayoutResponse {
  ids: string[];
  coords: ArrayBuffer;
  meta: {
    iterations: number;
    durationMs: number;
    nodeCount: number;
    edgeCount: number;
  };
}

function getRandomCoordinate(max: number): number {
  return (Math.random() - 0.5) * max;
}

function forceLayout(input: LayoutRequest): LayoutResponse {
  const requestedIterations = input.iterations ?? 120;
  const frameBudgetMs = input.frameBudgetMs ?? 20;
  const nodeMap = new Map<string, LayoutNode>();
  const startedAt = Date.now();

  const nodes = input.nodes.map((node) => ({
    ...node,
    x: Number.isFinite(node.x) && node.x !== 0 ? node.x : getRandomCoordinate(input.width),
    y: Number.isFinite(node.y) && node.y !== 0 ? node.y : getRandomCoordinate(input.height),
  }));

  nodes.forEach((node) => nodeMap.set(node.id, node));

  const repulsionStrength = 2200;
  const springStrength = 0.02;
  const damping = 0.8;
  let completedIterations = 0;

  for (let iteration = 0; iteration < requestedIterations; iteration += 1) {
    if (Date.now() - startedAt > frameBudgetMs) {
      break;
    }

    const velocityMap = new Map<string, { vx: number; vy: number }>();

    for (const node of nodes) {
      velocityMap.set(node.id, { vx: 0, vy: 0 });
    }

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const left = nodes[i];
        const right = nodes[j];

        const dx = left.x - right.x;
        const dy = left.y - right.y;
        const distSq = Math.max(1, dx * dx + dy * dy);
        const force = repulsionStrength / distSq;

        const leftVelocity = velocityMap.get(left.id);
        const rightVelocity = velocityMap.get(right.id);

        if (leftVelocity && rightVelocity) {
          leftVelocity.vx += (dx * force) / 100;
          leftVelocity.vy += (dy * force) / 100;
          rightVelocity.vx -= (dx * force) / 100;
          rightVelocity.vy -= (dy * force) / 100;
        }
      }
    }

    for (const link of input.links) {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);

      if (!source || !target) {
        continue;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;

      const sourceVelocity = velocityMap.get(source.id);
      const targetVelocity = velocityMap.get(target.id);

      if (sourceVelocity && targetVelocity) {
        sourceVelocity.vx += dx * springStrength;
        sourceVelocity.vy += dy * springStrength;
        targetVelocity.vx -= dx * springStrength;
        targetVelocity.vy -= dy * springStrength;
      }
    }

    for (const node of nodes) {
      const velocity = velocityMap.get(node.id);
      if (!velocity) {
        continue;
      }

      node.x += velocity.vx * damping;
      node.y += velocity.vy * damping;

      if (!Number.isFinite(node.x)) {
        node.x = getRandomCoordinate(input.width);
      }

      if (!Number.isFinite(node.y)) {
        node.y = getRandomCoordinate(input.height);
      }
    }

    completedIterations += 1;
  }

  const ids = nodes.map((node) => node.id);
  const coords = new Float32Array(nodes.length * 2);

  for (let i = 0; i < nodes.length; i += 1) {
    coords[i * 2] = nodes[i].x;
    coords[i * 2 + 1] = nodes[i].y;
  }

  return {
    ids,
    coords: coords.buffer,
    meta: {
      iterations: completedIterations,
      durationMs: Date.now() - startedAt,
      nodeCount: input.nodes.length,
      edgeCount: input.links.length,
    },
  };
}

workerScope.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const result = forceLayout(event.data);
  workerScope.postMessage(result, [result.coords]);
};
