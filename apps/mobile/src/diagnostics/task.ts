import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { BACKGROUND_DIAGNOSTICS_TASK, handleDiagnosticLocations } from "./task-handler";
import { FileSystemDiagnosticStorage } from "./file-storage";
import { ExpoSpeechAdapter } from "../adapters/speech";

export { BACKGROUND_DIAGNOSTICS_TASK, handleDiagnosticLocations } from "./task-handler";

// Module-scope registration using default adapters
const defaultStorage = new FileSystemDiagnosticStorage();
const defaultSpeech = new ExpoSpeechAdapter();

try {
  if (!TaskManager.isTaskDefined(BACKGROUND_DIAGNOSTICS_TASK)) {
    TaskManager.defineTask(
      BACKGROUND_DIAGNOSTICS_TASK,
      async ({ data, error }) => {
        if (error) {
          const session = await defaultStorage.getSession();
          if (session && session.status === "running") {
            session.errorMessage = error.message;
            await defaultStorage.saveSession(session);
          }
          return;
        }

        const { locations } = (data ?? {}) as {
          locations?: Location.LocationObject[];
        };

        if (locations && locations.length > 0) {
          await handleDiagnosticLocations(locations, defaultStorage, defaultSpeech);
        }
      }
    );
  }
} catch (err) {
  // Gracefully handle environments without native TaskManager (e.g. web or unit tests)
  console.warn("TaskManager background diagnostics registration note:", err);
}
