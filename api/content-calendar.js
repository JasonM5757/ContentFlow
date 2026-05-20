const CONTENT_CALENDAR = [
  {
    day: "Monday",
    topicType: "Container Sales",
    primaryKeyword: "shipping containers for sale in Tucson and Southern Arizona",
    title: "Shipping Containers for Sale in Tucson and Southern Arizona",
    slugBase: "shipping-containers-for-sale-tucson-southern-arizona",
    audience: "contractors, ranches, homeowners, and small businesses in Tucson, Pima County, Santa Cruz County, Cochise County, Graham County, and Southern Arizona",
    internalLinks: ["/#pricing", "/#inventory", "/#quote"]
  },
  {
    day: "Tuesday",
    topicType: "Container Rentals",
    primaryKeyword: "shipping container rentals in Tucson and Southern Arizona",
    title: "Shipping Container Rentals in Tucson and Southern Arizona",
    slugBase: "shipping-container-rentals-tucson-southern-arizona",
    audience: "jobsites, businesses, ranches, contractors, and property owners in Tucson, Pima County, Santa Cruz County, Cochise County, Graham County, and Southern Arizona needing temporary storage",
    internalLinks: ["/#rentals", "/#delivery", "/#quote"]
  },
  {
    day: "Wednesday",
    topicType: "Cool Stations",
    primaryKeyword: "mobile cooling station rentals in Tucson and Arizona",
    title: "Mobile Cooling Station Rentals for Tucson and Arizona Jobsites",
    slugBase: "mobile-cooling-station-rentals-tucson-arizona",
    audience: "construction crews, utility crews, public works, agriculture, industrial sites, and field operations in Tucson, Pima County, Santa Cruz County, Cochise County, Graham County, and Southern Arizona",
    internalLinks: ["/#cool-stations", "/#rentals", "/#quote"]
  },
  {
    day: "Thursday",
    topicType: "Mobile Offices",
    primaryKeyword: "mobile office containers in Tucson and Southern Arizona",
    title: "Mobile Office Containers for Tucson and Southern Arizona Jobsites",
    slugBase: "mobile-office-containers-tucson-southern-arizona",
    audience: "contractors, builders, project managers, field crews, and commercial businesses in Tucson, Pima County, Santa Cruz County, Cochise County, Graham County, and Southern Arizona",
    internalLinks: ["/#offices", "/#pricing", "/#quote"]
  },
  {
    day: "Friday",
    topicType: "Custom Builds",
    primaryKeyword: "custom shipping container builds in Tucson and Southern Arizona",
    title: "Custom Shipping Container Builds in Tucson and Southern Arizona",
    slugBase: "custom-shipping-container-builds-tucson-southern-arizona",
    audience: "homeowners, ranches, small businesses, workshops, custom project buyers, and commercial customers in Tucson, Pima County, Santa Cruz County, Cochise County, Graham County, and Southern Arizona",
    internalLinks: ["/#custom-builds", "/#upgrades", "/#quote"]
  },
  {
    day: "Saturday",
    topicType: "Tack Rooms",
    primaryKeyword: "shipping container tack rooms in Southern Arizona",
    title: "Shipping Container Tack Rooms for Ranches and Horse Properties",
    slugBase: "shipping-container-tack-rooms-southern-arizona",
    audience: "ranchers, horse owners, ropers, rodeo families, equestrian properties, farms, and agricultural operations in Tucson, Pima County, Santa Cruz County, Cochise County, Graham County, and Southern Arizona",
    internalLinks: ["/#custom-builds", "/#upgrades", "/#quote"]
  },
  {
    day: "Sunday",
    topicType: "FAQ and Education",
    primaryKeyword: "shipping container delivery requirements in Southern Arizona",
    title: "What to Know Before Scheduling Shipping Container Delivery in Southern Arizona",
    slugBase: "shipping-container-delivery-requirements-southern-arizona",
    audience: "first-time container buyers and renters in Tucson, Pima County, Santa Cruz County, Cochise County, Graham County, and Southern Arizona",
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
