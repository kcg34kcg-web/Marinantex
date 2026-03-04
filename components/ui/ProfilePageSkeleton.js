import React from 'react';
import { Card, CardHeader, CardContent, CardFooter } from './Card';
import { Skeleton } from './skeleton';
import styles from './ProfilePage.module.css'; // Re-using the same styles for layout

export function ProfilePageSkeleton() {
  return (
    <div className={styles.container}>
      <Skeleton className={styles.pageTitle} style={{ width: '180px', height: '28px' }} />
      <Card>
        <CardContent>
          <div className={styles.profileHeader}>
            <Skeleton className={styles.avatar} style={{ borderRadius: '50%' }} />
            <div className={styles.profileInfo}>
              <Skeleton className={styles.userName} style={{ width: '200px', height: '20px' }} />
              <Skeleton className={styles.userEmail} style={{ width: '250px', height: '14px', marginTop: '0.5rem' }} />
            </div>
          </div>
        </CardContent>
        <CardFooter className={styles.actions}>
          <Skeleton style={{ width: '120px', height: '38px' }} />
          <Skeleton style={{ width: '90px', height: '38px' }} />
        </CardFooter>
      </Card>
    </div>
  );
}
