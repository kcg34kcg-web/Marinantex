import React from 'react';
import { useUIPrefs } from '../../contexts/UIPrefsContext';
import { SettingsGroup } from '../../components/ui/SettingsGroup';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { Button } from '../../components/ui/Button';

export function AccessibilitySettings() {
  const { prefs, updatePref } = useUIPrefs();
  const { accessibility } = prefs;

  return (
    <div>
      <h2 className="settings-page-title">Erişilebilirlik</h2>
      <SettingsGroup
        title="Yüksek Kontrast Modu"
        description="Okunabilirliği artırmak için renk kontrastını yükseltir."
      >
        <ToggleSwitch
          checked={accessibility.highContrast}
          onChange={(isChecked) => updatePref('accessibility', 'highContrast', isChecked)}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Renk Körlüğü Dostu Mod"
        description="Vurgu renklerini renk körlüğü türlerine daha uygun hale getirir."
      >
        <ToggleSwitch
          checked={accessibility.colorblindFriendly}
          onChange={(isChecked) => updatePref('accessibility', 'colorblindFriendly', isChecked)}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Klavye Kısayolları"
        description="Uygulamada kullanabileceğiniz klavye kısayollarının listesini görüntüleyin."
      >
        <Button variant="secondary" onClick={() => alert('Klavye kısayolları listesi burada gösterilecek.')}>
          Kısayolları Görüntüle
        </Button>
      </SettingsGroup>
    </div>
  );
}