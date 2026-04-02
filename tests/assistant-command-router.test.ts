import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSISTANT_COMMAND_COUNT, resolveDeterministicAssistantCommand } from '@/lib/assistant/command-router';

describe('assistant command router', () => {
  it('ships with 50 built-in commands', () => {
    expect(BUILTIN_ASSISTANT_COMMAND_COUNT).toBe(50);
  });

  it('resolves mail navigation command', () => {
    const plan = resolveDeterministicAssistantCommand({
      message: 'Mail sayfasını aç',
      userName: 'Kerim',
    });

    expect(plan).not.toBeNull();
    expect(plan?.intent).toBe('app.navigate');
    expect(plan?.actions[0]?.toolName).toBe('app.navigate');
    expect(plan?.actions[0]?.params.route).toBe('/dashboard/mail');
  });

  it('matches command regardless of uppercase/lowercase', () => {
    const plan = resolveDeterministicAssistantCommand({
      message: 'MAİL SAYFASINI AÇ',
      userName: 'Kerim',
    });

    expect(plan).not.toBeNull();
    expect(plan?.intent).toBe('app.navigate');
    expect(plan?.actions[0]?.params.route).toBe('/dashboard/mail');
  });

  it('matches command with common typo', () => {
    const plan = resolveDeterministicAssistantCommand({
      message: 'mail sayfasni ac',
      userName: 'Kerim',
    });

    expect(plan).not.toBeNull();
    expect(plan?.intent).toBe('app.navigate');
    expect(plan?.actions[0]?.params.route).toBe('/dashboard/mail');
  });

  it('resolves file open command with editor navigation and search', () => {
    const plan = resolveDeterministicAssistantCommand({
      message: 'Kira sözleşmesi dosyasını aç',
      userName: 'Kerim',
    });

    expect(plan).not.toBeNull();
    expect(plan?.intent).toBe('files.open');
    expect(plan?.actions.map((item) => item.toolName)).toEqual(['app.navigate', 'files.search']);
    expect(String(plan?.actions[0]?.params.route ?? '')).toContain('/editor?q=');
    expect(plan?.actions[1]?.params.query).toBe('kira sozlesmesi');
  });

  it('matches file open command with typo', () => {
    const plan = resolveDeterministicAssistantCommand({
      message: 'kira sozlesmesi dosyasni ac',
      userName: 'Kerim',
    });

    expect(plan).not.toBeNull();
    expect(plan?.intent).toBe('files.open');
    expect(plan?.actions[0]?.toolName).toBe('app.navigate');
    expect(plan?.actions[1]?.toolName).toBe('files.search');
  });

  it('resolves client message command with confirmation', () => {
    const plan = resolveDeterministicAssistantCommand({
      message: 'Müvekkil Kerime mesaj at "Duruşma saatimiz 14:00"',
      userName: 'Kerim',
    });

    expect(plan).not.toBeNull();
    expect(plan?.intent).toBe('clients.message.send');
    expect(plan?.needsConfirmation).toBe(true);
    expect(plan?.actions[0]?.toolName).toBe('clients.message.send');
    expect(plan?.actions[0]?.params.clientName).toBe('kerim');
    expect(plan?.actions[0]?.params.body).toBe('Duruşma saatimiz 14:00');
  });

  it('asks for message body when client message text is empty', () => {
    const plan = resolveDeterministicAssistantCommand({
      message: 'Müvekkil Kerime mesaj at ""',
      userName: 'Kerim',
    });

    expect(plan).not.toBeNull();
    expect(plan?.intent).toBe('clients.message.compose');
    expect(plan?.actions).toHaveLength(0);
  });
});
