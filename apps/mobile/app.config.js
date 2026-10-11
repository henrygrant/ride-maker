module.exports = ({ config }) => {
  const isTest =
    process.env.EXPO_PUBLIC_TEST_MODE === "true" ||
    process.env.APP_ENV === "test";

  const plugins = [...(config.plugins || [])].filter((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    return typeof name === "string" && !name.includes("withCleartextTraffic");
  });

  if (isTest) {
    plugins.unshift("./plugins/withCleartextTraffic.js");
  }

  return {
    ...config,
    android: {
      ...config.android,
      package: isTest ? "net.thg3.ridemaker.e2e" : "net.thg3.ridemaker",
    },
    plugins,
  };
};
