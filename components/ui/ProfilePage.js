import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './Card';
import { ProfilePageSkeleton } from './ProfilePageSkeleton';
import styles from './ProfilePage.module.css';

// Mock user data for demonstration. In a real app, this would come from an API call.
// Moved outside the component to prevent re-declaration on every render.
const mockUser = {
    name: 'Av. Elif Yılmaz',
    email: 'elif.yilmaz@hukukburosu.com',
    avatarUrl: 'https://i.pravatar.cc/150?u=elif.yilmaz' // Placeholder image
};

export function ProfilePage() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate a network request
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleLogout = () => {
    // Placeholder for actual logout logic which is NOT touched
    console.log('Logout action triggered');
  };

  if (isLoading) {
    return <ProfilePageSkeleton />;
  }

  return ( 
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>Profilim</h1>
      <Card>
        <CardContent>
          <div className={styles.profileHeader}>
            <img src={mockUser.avatarUrl} alt={mockUser.name} className={styles.avatar} />
            <div className={styles.profileInfo}>
              <h2 className={styles.userName}>{mockUser.name}</h2>
              <p className={styles.userEmail}>{mockUser.email}</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className={styles.actions}>
          <Button variant="secondary">Profili Düzenle</Button>
          <Button variant="primary" onClick={handleLogout}>Çıkış Yap</Button>
        </CardFooter>
      </Card>
    </div>
  );
}