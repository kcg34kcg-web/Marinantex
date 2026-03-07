import { ProviderStubAdapter } from "./provider-stub-adapter";

export class YandexMailAdapter extends ProviderStubAdapter {
  constructor() {
    super({
      provider: "YANDEX",
      defaultDomain: "yandex.local",
      defaultScopes: ["mail:read", "mail:write", "mail:send"],
      containers: [
        { id: "inbox", name: "Inbox", type: "folder" },
        { id: "sent", name: "Sent", type: "folder" },
        { id: "drafts", name: "Drafts", type: "folder" },
        { id: "spam", name: "Spam", type: "folder" }
      ]
    });
  }
}
