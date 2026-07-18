# SFA Mobile App Android Studio Setup Guide

This guide explains how to open, compile, and run the mobile application locally using **Android Studio**.

---

## 1. Prerequisites

1. Ensure **Android Studio** is installed on your computer.
2. Ensure you have the Android SDK packages downloaded. The default SDK path on Windows is:
   `C:\Users\User\AppData\Local\Android\Sdk`

---

## 2. Project Location

The native Android project is located at:
`C:\Users\User\Desktop\new crm\SFA\MobileApp\android`

A `local.properties` file has already been generated in this directory pointing to the local Android SDK path:
```properties
sdk.dir=C\:\\Users\\User\\AppData\\Local\\Android\\Sdk
```

---

## 3. Opening the Project in Android Studio

1. Open **Android Studio**.
2. Select **Open** (or **Open an existing Android Studio project**).
3. Navigate to and select the `android` folder:
   `C:\Users\User\Desktop\new crm\SFA\MobileApp\android`
4. Wait for Android Studio to automatically sync the Gradle files and build the project indexes (this may take 2-3 minutes on first load).

---

## 4. Building the Installable APK File

To compile the app into an installable `.apk` file:
1. In the Android Studio menu bar, click:
   **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**
2. Gradle will compile the project locally.
3. Once completed, a popup message will appear in the bottom-right corner. Click **Locate** to open the folder containing your APK file (`app-debug.apk`).
4. Copy this APK to any Android phone to install and run the app.

---

## 5. Running Directly on a Phone / Emulator

1. **Physical Phone (USB):** Enable **USB Debugging** in your phone's developer options and connect it via USB.
2. **Emulator:** Start an Android Virtual Device (AVD) from Android Studio.
3. In Android Studio, select your phone or emulator from the device dropdown list in the top toolbar.
4. Click the green **Run (Play button)** to compile and install the app directly.

---

## 6. Connecting to your PC Backend Server (Wi-Fi)

To connect the mobile app to the Node.js backend running on your PC:
1. Connect both your PC and your phone to the **same Wi-Fi network**.
2. Find your PC's local IP address (open command prompt, run `ipconfig`, look for `IPv4 Address`, e.g., `192.168.1.100`).
3. Open the mobile app on your phone.
4. On the login screen, tap **⚙️ Wi-Fi Server Connection Settings** at the bottom.
5. Enter your PC's IP and server port, for example:
   `http://192.168.1.100:5000/api`
6. Tap **Save** and log in!
