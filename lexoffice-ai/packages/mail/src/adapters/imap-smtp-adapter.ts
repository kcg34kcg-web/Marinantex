import { ProviderStubAdapter } from "./provider-stub-adapter";

export class ImapSmtpAdapter extends ProviderStubAdapter {
  constructor() {
    super({
      provider: "IMAP_SMTP",
      defaultDomain: "imap.local",
      defaultScopes: ["imap.read", "smtp.send"],
      containers: [
        { id: "INBOX", name: "Inbox", type: "folder" },
        { id: "Sent", name: "Sent", type: "folder" },
        { id: "Drafts", name: "Drafts", type: "folder" },
        { id: "Archive", name: "Archive", type: "folder" }
      ]
    });
  }
}
