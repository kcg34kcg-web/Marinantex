import { ProviderStubAdapter } from "./provider-stub-adapter";

export class GmailProviderAdapter extends ProviderStubAdapter {
  constructor() {
    super({
      provider: "GMAIL",
      defaultDomain: "gmail.local",
      defaultScopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
      containers: [
        { id: "INBOX", name: "Inbox", type: "system" },
        { id: "SENT", name: "Sent", type: "system" },
        { id: "DRAFT", name: "Drafts", type: "system" },
        { id: "IMPORTANT", name: "Important", type: "label" }
      ]
    });
  }
}
