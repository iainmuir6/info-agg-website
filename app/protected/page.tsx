"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandableSection } from "@/components/expandable-section";

const tabs = [
  { name: "News", color: "blue", logo: "NYT" },
  { name: "Sports", color: "orange", logo: "ESPN" },
  { name: "Markets", color: "green", logo: "Robinhood" },
  { name: "Media", color: "red", logo: "YouTube" },
  { name: "Misc", color: "purple", logo: "Tools" },
];

const colorClasses = {
  blue: "text-blue-600 border-blue-600",
  orange: "text-orange-600 border-orange-600", 
  green: "text-green-600 border-green-600",
  red: "text-red-600 border-red-600",
  purple: "text-purple-600 border-purple-600",
};

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("News");

  const renderTabContent = () => {
    switch (activeTab) {
      case "News":
        return (
          <div className="flex-1 w-full flex flex-col gap-6">
            <div className="space-y-4">
              <ExpandableSection
                title="The New York Times"
                logo="/assets/logos/news/nyt.svg"
                logoAlt="New York Times"
                defaultExpanded={true}
              >
                <div className="space-y-4">
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Image</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">News Title...</h4>
                      <p className="text-sm text-gray-600 mt-1">Summary...</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>By John Smith</span>
                        <span>10/18/2025 4:12 pm</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Image</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">News Title...</h4>
                      <p className="text-sm text-gray-600 mt-1">Summary...</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>By Jane Doe</span>
                        <span>10/18/2025 3:45 pm</span>
                      </div>
                    </div>
                  </div>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="The Wall Street Journal"
                logo="/assets/logos/news/wsj.svg"
                logoAlt="Wall Street Journal"
              >
                <div className="space-y-4">
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Image</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">Financial News...</h4>
                      <p className="text-sm text-gray-600 mt-1">Market analysis and business updates...</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>By Market Reporter</span>
                        <span>10/18/2025 2:30 pm</span>
                      </div>
                    </div>
                  </div>
                </div>
              </ExpandableSection>

            </div>
          </div>
        );

      case "Sports":
        return (
          <div className="flex-1 w-full flex flex-col gap-6">
            <div className="space-y-4">
              <ExpandableSection
                title="ESPN"
                logo="/assets/logos/sports/espn.svg"
                logoAlt="ESPN"
                defaultExpanded={true}
              >
                <div className="space-y-4">
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Score</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">Lakers vs Warriors</h4>
                      <p className="text-sm text-gray-600 mt-1">Final: Lakers 112 - Warriors 108</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>NBA</span>
                        <span>10/18/2025 10:30 pm</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Score</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">Chiefs vs Bills</h4>
                      <p className="text-sm text-gray-600 mt-1">Final: Chiefs 24 - Bills 21</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>NFL</span>
                        <span>10/18/2025 7:45 pm</span>
                      </div>
                    </div>
                  </div>
                </div>
              </ExpandableSection>

            </div>
          </div>
        );

      case "Markets":
        return (
          <div className="flex-1 w-full flex flex-col gap-6">
            <div className="space-y-4">
              <ExpandableSection
                title="Robinhood"
                logo="/assets/logos/markets/robinhood.svg"
                logoAlt="Robinhood"
                defaultExpanded={true}
              >
                <div className="space-y-4">
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Chart</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">AAPL - Apple Inc.</h4>
                      <p className="text-sm text-gray-600 mt-1">$175.43 (+2.15%)</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>NASDAQ</span>
                        <span>4:00 PM ET</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Chart</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">TSLA - Tesla Inc.</h4>
                      <p className="text-sm text-gray-600 mt-1">$248.12 (-1.23%)</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>NASDAQ</span>
                        <span>4:00 PM ET</span>
                      </div>
                    </div>
                  </div>
                </div>
              </ExpandableSection>

            </div>
          </div>
        );

      case "Media":
        return (
          <div className="flex-1 w-full flex flex-col gap-6">
            <div className="space-y-4">

              <ExpandableSection
                title="YouTube"
                logo="/assets/logos/media/youtube.svg"
                logoAlt="YouTube"
                defaultExpanded={true}
              >
                <div className="space-y-4">
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Video</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">Trending Tech Review</h4>
                      <p className="text-sm text-gray-600 mt-1">Latest iPhone 15 Pro review and comparison</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>TechChannel</span>
                        <span>2.3M views</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Video</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">Cooking Tutorial</h4>
                      <p className="text-sm text-gray-600 mt-1">How to make perfect pasta from scratch</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>ChefMaster</span>
                        <span>856K views</span>
                      </div>
                    </div>
                  </div>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Reddit"
                logo="/assets/logos/media/reddit.svg"
                logoAlt="Reddit"
              >
                <div className="space-y-4">
                  <div className="flex gap-4 p-3">
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center">
                      <span className="text-gray-500 text-xs">Post</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">r/technology - AI Discussion</h4>
                      <p className="text-sm text-gray-600 mt-1">What do you think about the future of AI?</p>
                      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                        <span>r/technology</span>
                        <span>2.1K upvotes</span>
                      </div>
                    </div>
                  </div>
                </div>
              </ExpandableSection>

            </div>
          </div>
        );

      case "Misc":
        return (
          <div className="flex-1 w-full flex flex-col gap-6">
            <div className="w-full">
              <h1 className="text-3xl font-bold mb-2">Miscellaneous</h1>
              <p className="text-muted-foreground">
                Various tools, utilities, and miscellaneous information.
              </p>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Weather</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Current weather conditions and forecasts will be displayed here.
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Calendar</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Important dates, holidays, and calendar events will appear here.
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Tools</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Useful online tools and utilities will be shown here.
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Bookmarks</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Your saved bookmarks and favorite links will be displayed here.
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Personal notes and reminders will appear here.
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Random</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Random facts, quotes, and interesting content will be shown here.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
      <div className="w-full">
      {/* Navigation */}
      <nav className="w-full max-w-5xl mx-auto">
        <div className="flex justify-center">
          <div className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                className={`px-2 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.name
                    ? colorClasses[tab.color as keyof typeof colorClasses]
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {tab.name}
              </button>
            ))}
          </div>
        </div>
        
        {/* Double divider lines below navigation */}
        <div className="w-full max-w-5xl mx-auto mt-2">
          <div className="flex justify-center">
            <div className="flex space-x-8">
              {tabs.map((tab) => (
                <div key={tab.name} className="px-2">
                  {activeTab === tab.name ? (
                    <div className={`h-2 w-full ${
                      colorClasses[tab.color as keyof typeof colorClasses]
                    }`}>
                      <div className={`h-0.5 w-full border-b-2 ${
                        colorClasses[tab.color as keyof typeof colorClasses]
                      }`}></div>
                      <div className={`h-0.5 w-full border-b-2 ${
                        colorClasses[tab.color as keyof typeof colorClasses]
                      }`}></div>
                    </div>
                  ) : (
                    <div className="h-2 w-full" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Tab Content */}
      <div className="mt-8">
        {renderTabContent()}
      </div>
    </div>
  );
}