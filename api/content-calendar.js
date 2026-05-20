const CONTENT_CALENDAR = [
  {
    day: "Monday",
    topicType: "Container Sales",
    primaryKeyword: "shipping containers for sale in Arizona",
    title: "Shipping Containers for Sale in Arizona",
    slugBase: "shipping-containers-for-sale-arizona",
    audience: "contractors, ranches, homeowners, and small businesses in Southern Arizona",
    internalLinks: ["/#pricing", "/#inventory", "/#quote"]
  },
  {
    day: "Tuesday",
    topicType: "Container Rentals",
    primaryKeyword: "shipping container rentals in Arizona",
    title: "Shipping Container Rentals in Arizona",
    slugBase: "shipping-container-rentals-arizona",
    audience: "jobsites, businesses, ranches, and property owners needing temporary storage",
    internalLinks: ["/#rentals", "/#delivery", "/#quote"]
  },
  {
    day: "Wednesday",
    topicType: "Cool Stations",
    primaryKeyword: "mobile cooling station rentals Arizona",
    title: "Mobile Cooling Station Rentals for Arizona Jobsites",
    slugBase: "mobile-cooling-station-rentals-arizona",
    audience: "construction crews, utility crews, public works, agriculture, and field operations",
    internalLinks: ["/#cool-stations", "/#rentals", "/#quote"]
  },
  {
    day: "Thursday",
    topicType: "Mobile Offices",
    primaryKeyword: "mobile office containers Arizona",
    title: "Mobile Office Containers for Arizona Jobsites",
    slugBase: "mobile-office-containers-arizona",
    audience: "contractors, builders, project managers, and field crews",
    internalLinks: ["/#offices", "/#pricing", "/#quote"]
  },
  {
    day: "Friday",
    topicType: "Custom Builds",
    primaryKeyword: "custom shipping container builds Arizona",
    title: "Custom Shipping Container Builds in Arizona",
    slugBase: "custom-shipping-container-builds-arizona",
    audience: "homeowners, ranches, small businesses, workshops, and custom project buyers",
    internalLinks: ["/#custom-builds", "/#upgrades", "/#quote"]
  },
  {
    day: "Saturday",
    topicType: "Ranch and Agriculture",
    primaryKeyword: "shipping containers for ranch storage Arizona",
    title: "Shipping Containers for Ranch Storage in Arizona",
    slugBase: "shipping-containers-ranch-storage-arizona",
    audience: "ranches, farms, horse owners, feed storage users, and agricultural operations",
    internalLinks: ["/#custom-builds", "/#inventory", "/#quote"]
  },
  {
    day: "Sunday",
    topicType: "FAQ and Education",
    primaryKeyword: "shipping container delivery requirements Arizona",
    title: "What to Know Before Scheduling Shipping Container Delivery",
    slugBase: "shipping-container-delivery-requirements-arizona",
    audience: "first-time container buyers and renters",
    internalLinks: ["/#delivery", "/#pricing", "/#quote"]
  }
];

function getArizonaDayName(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    weekday: "long"
  }).format(date);
}

function getTodaysTopic(date = new Date()) {
  const day = getArizonaDayName(date);
  return CONTENT_CALENDAR.find((item) => item.day === day) || CONTENT_CALENDAR[0];
}

module.exports = {
  CONTENT_CALENDAR,
  getTodaysTopic
};
