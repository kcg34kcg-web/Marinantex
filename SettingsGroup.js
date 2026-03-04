import React from 'react';
import styles from './SettingsGroup.module.css';

export function SettingsGroup({ title, description, children }) {
  return (
    <div className={styles.group}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.description}>{description}</p>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}