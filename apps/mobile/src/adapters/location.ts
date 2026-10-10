import * as Location from "expo-location";
import {
  BackgroundLocationOptions,
  LocationAdapter,
  LocationPermissionsStatus,
  PermissionStatus,
} from "./location-types";

export * from "./location-types";

export class ExpoLocationAdapter implements LocationAdapter {
  async getPermissionsAsync(): Promise<LocationPermissionsStatus> {
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    return {
      foreground: fg.status,
      background: bg.status,
      canAskAgainForeground: fg.canAskAgain,
      canAskAgainBackground: bg.canAskAgain,
    };
  }

  async requestForegroundPermissionsAsync(): Promise<PermissionStatus> {
    const res = await Location.requestForegroundPermissionsAsync();
    return res.status;
  }

  async requestBackgroundPermissionsAsync(): Promise<PermissionStatus> {
    const res = await Location.requestBackgroundPermissionsAsync();
    return res.status;
  }

  async isBackgroundLocationAvailableAsync(): Promise<boolean> {
    return Location.isBackgroundLocationAvailableAsync();
  }

  async hasStartedLocationUpdatesAsync(taskName: string): Promise<boolean> {
    return Location.hasStartedLocationUpdatesAsync(taskName);
  }

  async startBackgroundLocationUpdatesAsync(
    taskName: string,
    options: BackgroundLocationOptions
  ): Promise<void> {
    await Location.startLocationUpdatesAsync(taskName, {
      accuracy: options.accuracy ?? Location.Accuracy.BestForNavigation,
      timeInterval: options.timeInterval ?? 1000,
      distanceInterval: options.distanceInterval ?? 0,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: options.notificationTitle,
        notificationBody: options.notificationBody,
        notificationColor: options.notificationColor ?? "#ec4b35",
        killServiceOnDestroy: false,
      },
      pausesUpdatesAutomatically: false,
    });
  }

  async stopBackgroundLocationUpdatesAsync(taskName: string): Promise<void> {
    const isStarted = await Location.hasStartedLocationUpdatesAsync(taskName);
    if (isStarted) {
      await Location.stopLocationUpdatesAsync(taskName);
    }
  }
}
