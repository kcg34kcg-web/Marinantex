import React from 'react';
import { useThemeSettings } from './components/theme/theme-settings-provider';
import './SettingsPage.css';
import Card from './Card';
import Button from './Button';
import Badge from './Badge';
import Input from './Input';
import Switch from './Switch';
import Select from './Select';

// Kod tekrarını önlemek ve okunabilirliği artırmak için yeniden kullanılabilir bir bileşen
interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface SettingsRadioGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly RadioOption<T>[];
}

function SettingsRadioGroup<T extends string>({
  value,
  onChange,
  options,
}: SettingsRadioGroupProps<T>) {
  return (
    <div className="radio-group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const SettingsPage: React.FC = () => {
  const themeSettings = useThemeSettings();

  // Client mount olana kadar yüklenme durumu
  if (!themeSettings.isClient) {
    return <div className="settings-container">Ayarlar yükleniyor...</div>;
  }

  const {
    settings,
    setTheme,
    setFontSize,
    setFontFamily,
    setLineHeight,
    setReduceMotion,
    setHighContrast,
    setSidebarDensity,
    setDefaultMode,
    setAutoSourcePanel,
  } = themeSettings;

  // Setter'lardan tipleri türet (provider'dan type export etmene gerek kalmaz)
  type ThemeValue = Parameters<typeof setTheme>[0];
  type FontSizeValue = Parameters<typeof setFontSize>[0];
  type FontFamilyValue = Parameters<typeof setFontFamily>[0];
  type LineHeightValue = Parameters<typeof setLineHeight>[0];
  type SidebarDensityValue = Parameters<typeof setSidebarDensity>[0];
  type DefaultModeValue = Parameters<typeof setDefaultMode>[0];

  const fontSizeOptions = [
    { value: 'small', label: 'Küçük' },
    { value: 'medium', label: 'Orta' },
    { value: 'large', label: 'Büyük' },
    { value: 'xl', label: 'Çok Büyük' },
  ] as const satisfies readonly RadioOption<FontSizeValue>[];

  // NOT:
  // Provider'daki LineHeightSetting büyük ihtimalle 'compact' | 'normal' (veya 'relaxed')
  // Eğer burada hâlâ hata alırsan 'normal' yerine provider'daki gerçek değeri yaz.
  const lineHeightOptions = [
    { value: 'compact', label: 'Kompakt' },
    { value: 'normal', label: 'Rahat' },
  ] as const satisfies readonly RadioOption<LineHeightValue>[];

  // NOT:
  // Provider'daki SidebarDensitySetting büyük ihtimalle 'compact' | 'comfortable'
  // Eğer burada hâlâ hata alırsan hover ile tipi kontrol edip value'ları birebir değiştir.
  const sidebarDensityOptions = [
    { value: 'compact', label: 'Dar' },
    { value: 'comfortable', label: 'Geniş' },
  ] as const satisfies readonly RadioOption<SidebarDensityValue>[];

  return (
    <div className="settings-container">
      <Card>
        <h3 className="settings-section-header">Görünüm</h3>

        <div className="setting-item">
          <label htmlFor="theme-select">Tema</label>
          <Select
            id="theme-select"
            value={settings.theme}
            onChange={(e) => setTheme(e.target.value as ThemeValue)}
          >
            <option value="light">Açık (Varsayılan)</option>
            <option value="dark">Koyu</option>
            <option value="corporate">Kurumsal Odak</option>
          </Select>
        </div>

        <div className="setting-item">
          <label htmlFor="font-select">Yazı Tipi</label>
          <Select
            id="font-select"
            value={settings.fontFamily}
            onChange={(e) => setFontFamily(e.target.value as FontFamilyValue)}
          >
            <option value="sans">Inter (Sans-Serif)</option>
            <option value="serif">Lora (Serif)</option>
            <option value="mono">Fira Code (Monospace)</option>
          </Select>
        </div>

        <div className="setting-item">
          <label>Yazı Büyüklüğü</label>
          <SettingsRadioGroup
            value={settings.fontSize}
            onChange={setFontSize}
            options={fontSizeOptions}
          />
        </div>

        <div className="setting-item">
          <label>Satır Yüksekliği</label>
          <SettingsRadioGroup
            value={settings.lineHeight}
            onChange={setLineHeight}
            options={lineHeightOptions}
          />
        </div>

        <div className="setting-item">
          <label>Kenar Çubuğu Yoğunluğu</label>
          <SettingsRadioGroup
            value={settings.sidebarDensity}
            onChange={setSidebarDensity}
            options={sidebarDensityOptions}
          />
        </div>
      </Card>

      <Card>
        <h3 className="settings-section-header">Erişilebilirlik</h3>

        <div className="setting-item switch">
          <label htmlFor="high-contrast-toggle">Yüksek Kontrast Modu</label>
          <Switch
            id="high-contrast-toggle"
            checked={settings.highContrast}
            onChange={(e) => setHighContrast(e.target.checked)}
          />
        </div>

        <div className="setting-item switch">
          <label htmlFor="reduce-motion-toggle">Animasyonları Azalt</label>
          <Switch
            id="reduce-motion-toggle"
            checked={settings.reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
          />
        </div>
      </Card>

      <Card>
        <h3 className="settings-section-header">Davranış</h3>

        <div className="setting-item">
          <label htmlFor="default-mode-select">Varsayılan Çalışma Modu</label>
          <Select
            id="default-mode-select"
            value={settings.defaultMode}
            onChange={(e) => setDefaultMode(e.target.value as DefaultModeValue)}
          >
            <option value="chat">Sohbet</option>
            <option value="review">Belge İnceleme</option>
            <option value="research">Araştırma</option>
          </Select>
        </div>

        <div className="setting-item switch">
          <label htmlFor="source-panel-toggle">Otomatik Kaynak Paneli</label>
          <Switch
            id="source-panel-toggle"
            checked={settings.autoSourcePanel}
            onChange={(e) => setAutoSourcePanel(e.target.checked)}
          />
        </div>
      </Card>

      <Card>
        <h3 className="settings-section-header">Örnek Bileşenler</h3>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.9rem',
            margin: '0 0 1rem 0',
          }}
        >
          Aşağıdaki bileşenler, seçtiğiniz tema ve ayarlara göre anında güncellenir.
        </p>

        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Button variant="primary">Ana Buton</Button>
          <Button variant="secondary">İkincil Buton</Button>
          <Badge variant="success">Başarılı</Badge>
          <Badge variant="danger">Hata</Badge>
          <Badge variant="warning">Uyarı</Badge>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <label
            htmlFor="example-input"
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: 'var(--text-muted)',
            }}
          >
            Örnek Girdi Alanı
          </label>
          <Input id="example-input" placeholder="Buraya yazın..." />
        </div>
      </Card>
    </div>
  );
};

export default SettingsPage;