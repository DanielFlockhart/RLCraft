import './globals.css';

export const metadata = {
  title: 'RlCraft Realtime Dashboard',
  description: 'Local dashboard for RlCraft training and Minecraft server state'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
