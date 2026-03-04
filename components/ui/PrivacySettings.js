import React from 'react';
import { useUIPrefs } from '../../contexts/UIPrefsContext';
import { SettingsGroup } from '../../components/ui/SettingsGroup';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { Input } from '../../components/ui/Input';
import styles from './PrivacySettings.module.css';

export function PrivacySettings() {
  const { prefs, updatePref } = useUIPrefs();
  const { privacy } = prefs;

  return (
    <div>
      <h2 className="settings-page-title">Veri & Gizlilik</h2>
      <SettingsGroup
        title="Geçmişi Kaydet"
        description="Sohbet geçmişinizin kaydedilip kaydedilmeyeceğini belirleyin."
      >
        <ToggleSwitch
          checked={privacy.saveHistory}
          onChange={(isChecked) => updatePref('privacy', 'saveHistory', isChecked)}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Otomatik Oturum Zaman Aşımı"
        description="Hareketsizlik durumunda oturumun kaç dakika sonra otomatik olarak kapatılacağını belirleyin."
      >
        <div className={styles.inputContainer}>
          <Input
            type="number"
            value={privacy.autoSessionTimeout}
            onChange={(e) => updatePref('privacy', 'autoSessionTimeout', parseInt(e.target.value, 10) || 0)}
            min="0"
          />
          <span>dakika</span>
        </div>
      </SettingsGroup>
    </div>
  );
}