import { ProviderStubAdapter } from "./provider-stub-adapter";

export class MicrosoftGraphMailAdapter extends ProviderStubAdapter {
  constructor() {
    super({
      provider: "MICROSOFT_365",
      defaultDomain: "m365.local",
      defaultScopes: ["Mail.Read", "Mail.Send", "offline_access"],
      containers: [
        { id: "inbox", name: "Inbox", type: "folder" },
        { id: "sentitems", name: "Sent Items", type: "folder" },
        { id: "drafts", name: "Drafts", type: "folder" },
        { id: "archive", name: "Archive", type: "folder" }
      ]
    });
  }
}
