import React from 'react';
import styles from './Button.module.css';

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    className
  ].join(' ');

  return (
    <button className={classNames} {...props}>{children}</button>
  );
}