export type PermissionStatus = "granted" | "denied" | "undetermined";

export interface LocationPermissionsStatus {
  foreground: PermissionStatus;
  background: PermissionStatus;
  canAskAgainForeground: boolean;
  canAskAgainBackground: boolean;
}

export interface BackgroundLocationOptions {
  accuracy?: number;
  timeInterval?: number;
  distanceInterval?: number;
  notificationTitle: string;
  notificationBody: string;
  notificationColor?: string;
}

export interface LocationAdapter {
  getPermissionsAsync(): Promise<LocationPermissionsStatus>;
  requestForegroundPermissionsAsync(): Promise<PermissionStatus>;
  requestBackgroundPermissionsAsync(): Promise<PermissionStatus>;
  isBackgroundLocationAvailableAsync(): Promise<boolean>;
  hasStartedLocationUpdatesAsync(taskName: string): Promise<boolean>;
  startBackgroundLocationUpdatesAsync(
    taskName: string,
    options: BackgroundLocationOptions
  ): Promise<void>;
  stopBackgroundLocationUpdatesAsync(taskName: string): Promise<void>;
}
