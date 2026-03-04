import type { IsoDateTime, Uuid } from "./common.model";

export interface ShareLinkCommentModel {
  id: Uuid;
  tenantId: Uuid;
  shareLinkId: Uuid;
  authorName: string;
  body: string;
  createdAt: IsoDateTime;
}
