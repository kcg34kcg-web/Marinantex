import React from 'react';
import { useUIPrefs } from '../../contexts/UIPrefsContext';
import { Button } from '../../components/ui/Button';
import { SettingsGroup } from '../../components/ui/SettingsGroup';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import styles from './AppearanceSettings.module.css';

export function AppearanceSettings() {
  const { prefs, updatePref } = useUIPrefs();
  const { appearance } = prefs;

  // Helper function to create a button group for a setting
  const renderAppearanceOptions = (key, options) => {
    const currentValue = prefs.appearance[key];
    return (
      <div className={styles.buttonGroup}>
        {options.map(option => (
          <Button
            key={option.value}
            variant={currentValue === option.value ? 'primary' : 'secondary'}
            onClick={() => updatePref('appearance', key, option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  };

  const themeOptions = [
    { value: 'light', label: 'Açık' },
    { value: 'dark', label: 'Koyu' },
    { value: 'corporate', label: 'Kurumsal' },
  ];

  const fontOptions = [
    { value: 'sans', label: 'Sans-Serif' },
    { value: 'serif', label: 'Serif' },
  ];

  const fontSizeOptions = [
    { value: 'small', label: 'Küçük' },
    { value: 'medium', label: 'Orta' },
    { value: 'large', label: 'Büyük' },
  ];

  const lineHeightOptions = [
    { value: 'compact', label: 'Yoğun' },
    { value: 'comfortable', label: 'Rahat' },
  ];

  const sidebarDensityOptions = [
    { value: 'wide', label: 'Geniş' },
    { value: 'narrow', label: 'Dar' },
  ];

  const handleReduceMotionChange = (isChecked) => {
    updatePref('appearance', 'reduceMotion', isChecked)
  };

  return (
    <div>
      <h2 className="settings-page-title">Görünüm</h2>

      <SettingsGroup
        title="Tema"
        description="Uygulamanın genel renk temasını seçin."
      >
        {renderAppearanceOptions('theme', themeOptions)}
      </SettingsGroup>

      <SettingsGroup
        title="Yazı Tipi"
        description="Okuma ve arayüz metinleri için yazı tipini seçin."
      >
        {renderAppearanceOptions('fontFamily', fontOptions)}
      </SettingsGroup>

      <SettingsGroup
        title="Yazı Büyüklüğü"
        description="Uygulama genelindeki metin boyutunu ayarlayın."
      >
        {renderAppearanceOptions('fontSize', fontSizeOptions)}
      </SettingsGroup>

      <SettingsGroup
        title="Satır Yüksekliği"
        description="Metin satırları arasındaki boşluğu ayarlayın."
      >
        {renderAppearanceOptions('lineHeight', lineHeightOptions)}
      </SettingsGroup>

      <SettingsGroup
        title="Kenar Çubuğu Yoğunluğu"
        description="Navigasyon menüsünün genişliğini ayarlayın."
      >
        {renderAppearanceOptions('sidebarDensity', sidebarDensityOptions)}
      </SettingsGroup>

      <SettingsGroup
        title="Animasyonları Azalt"
        description="Arayüzdeki geçiş ve animasyonları azaltır."
      >
        <ToggleSwitch checked={appearance.reduceMotion} onChange={handleReduceMotionChange} />
      </SettingsGroup>
    </div>
  );
}