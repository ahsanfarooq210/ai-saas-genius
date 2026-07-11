export type ProjectTab =
  | "overview"
  | "architecture"
  | "diagrams"
  | "documentation"
  | "reviews"
  | "revisions"
  | "runtime";

export const demoProject = {
  name: "URL shortener with analytics",
  requirement:
    "Design a globally available URL shortener with branded links, click analytics, and a team workspace.",
  threadId: "swarm-demo-url-shortener",
  status: "Complete",
  createdAt: "Jul 11, 2026",
  complexity: "Medium",
  components: 8,
  diagrams: 4,
  documents: 6,
  iterations: 2,
};

export const projectTabs: ReadonlyArray<{ value: ProjectTab; label: string }> =
  [
    { value: "overview", label: "Overview" },
    { value: "architecture", label: "Architecture" },
    { value: "diagrams", label: "Diagrams" },
    { value: "documentation", label: "Documentation" },
    { value: "reviews", label: "Reviews" },
    { value: "revisions", label: "Revisions" },
    { value: "runtime", label: "Runtime" },
  ];

export const recentProjects = [
  {
    name: "URL shortener with analytics",
    status: "Complete",
    updated: "Just now",
    threadId: "swarm-demo-url-shortener",
  },
  {
    name: "Customer support inbox",
    status: "In review",
    updated: "2 hours ago",
    threadId: "swarm-demo-support-inbox",
  },
  {
    name: "Marketplace checkout",
    status: "Draft",
    updated: "Yesterday",
    threadId: "swarm-demo-checkout",
  },
];
