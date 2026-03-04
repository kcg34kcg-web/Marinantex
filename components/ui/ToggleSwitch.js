import React from 'react';
import styles from './ToggleSwitch.module.css';

export function ToggleSwitch({ checked, onChange, ...props }) {
  const handleOnChange = (e) => {
    if (onChange) {
      onChange(e.target.checked);
    }
  };

  return (
    <label className={styles.switch}>
      <input type="checkbox" checked={checked} onChange={handleOnChange} {...props} />
      <span className={styles.slider}></span>
    </label>
  );
}