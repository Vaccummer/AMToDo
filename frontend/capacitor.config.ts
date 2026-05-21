import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.amtodo.app',
  appName: 'AMToDo',
  webDir: 'dist-mobile',
  server: {
    androidScheme: 'http',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a1a',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#4ec9a0',
    },
  },
};

export default config;
