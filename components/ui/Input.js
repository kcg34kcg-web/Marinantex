import React from 'react';
import styles from './Input.module.css';

export function Input({ className = '', ...props }) {
  const classNames = [styles.input, className].join(' ');
  return <input className={classNames} {...props} />;
}