import React from 'react';
import { useUIPrefs } from '../../contexts/UIPrefsContext';
import { SettingsGroup } from '../../components/ui/SettingsGroup';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { Button } from '../../components/ui/Button';
import styles from './AppearanceSettings.module.css'; // Re-using button group style

export function BehaviorSettings() {
  const { prefs, updatePref } = useUIPrefs();
  const { behavior } = prefs;

  const renderSettingOptions = (category, key, options) => {
    const currentValue = prefs[category][key];
    return (
      <div className={styles.buttonGroup}>
        {options.map(option => (
          <Button
            key={option.value}
            variant={currentValue === option.value ? 'primary' : 'secondary'}
            onClick={() => updatePref(category, key, option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  };

  const defaultModeOptions = [
    { value: 'chat', label: 'Sohbet' },
    { value: 'review', label: 'Gözden Geçirme' },
    { value: 'research', label: 'Araştırma' },
  ];

  const responseFormatOptions = [
    { value: 'short', label: 'Kısa' },
    { value: 'detailed', label: 'Detaylı' },
    { value: 'bulleted', label: 'Maddeli' },
  ];

  return (
    <div>
      <h2 className="settings-page-title">Davranış</h2>
      <SettingsGroup
        title="Varsayılan Çalışma Modu"
        description="Uygulama açıldığında varsayılan olarak hangi modda başlayacağını seçin."
      >
        {renderSettingOptions('behavior', 'defaultMode', defaultModeOptions)}
      </SettingsGroup>

      <SettingsGroup
        title="Cevap Formatı"
        description="Asistanın cevaplarının varsayılan formatını belirleyin."
      >
        {renderSettingOptions('behavior', 'responseFormat', responseFormatOptions)}
      </SettingsGroup>

      <SettingsGroup
        title="Otomatik Kaynak Paneli"
        description="Cevaplarla birlikte ilgili kaynakların otomatik olarak gösterilip gösterilmeyeceğini ayarlayın."
      >
        <ToggleSwitch
          checked={behavior.autoShowSourcePanel}
          onChange={(isChecked) => updatePref('behavior', 'autoShowSourcePanel', isChecked)}
        />
      </SettingsGroup>
    </div>
  );
}