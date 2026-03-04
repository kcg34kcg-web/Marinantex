import type { FlatComment } from '@/app/types';

export interface CommentNode extends FlatComment {
  children: CommentNode[];
}

function sortNodes(nodes: CommentNode[]): void {
  nodes.sort((a, b) => {
    const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  for (const node of nodes) {
    if (node.children.length > 0) {
      sortNodes(node.children);
      node.reply_count = node.children.length;
    }
  }
}

export function buildCommentTree(comments: FlatComment[]): CommentNode[] {
  const map = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  for (const comment of comments) {
    map.set(comment.id, { ...comment, children: [] });
  }

  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortNodes(roots);
  return roots;
}

