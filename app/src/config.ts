/**
 * Point the app at your PhoneFinder server.
 *
 *  - iOS Simulator / Expo web .... http://localhost:4000
 *  - Android Emulator ............ http://10.0.2.2:4000
 *  - Physical phone on same WiFi . http://YOUR_COMPUTER_LAN_IP:4000
 *      (find it with `ipconfig` / `ifconfig`, then run:  npx expo start --lan)
 *  - Anywhere over the internet ... expose the server with:  ngrok http 4000
 *      and paste the https://xxxx.ngrok-free.app URL here.
 */
export const config = {
  API_BASE: 'http://localhost:4000',
};
