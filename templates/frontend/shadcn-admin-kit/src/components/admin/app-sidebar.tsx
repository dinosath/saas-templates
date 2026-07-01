import { createElement } from "react";
import {
  useCanAccess,
  useCreatePath,
  useGetResourceLabel,
  useHasDashboard,
  useResourceDefinitions,
  useTranslate,
} from "ra-core";
import { Link, useMatch } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { House, List, Shell } from "lucide-react";

/**
 * Navigation sidebar displaying menu items grouped by the `options.group`
 * property set on each `<Resource>`.  Resources without a group are rendered
 * first, in a plain `SidebarGroup` with no label.  Resources that share the
 * same group string are collected under a labelled `SidebarGroup`.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/appsidebar/#usage AppSidebar documentation}
 * @see {@link https://ui.shadcn.com/docs/components/sidebar shadcn/ui Sidebar component}
 * @see layout.tsx
 */
export function AppSidebar() {
  const hasDashboard = useHasDashboard();
  const resources = useResourceDefinitions();
  const { openMobile, setOpenMobile } = useSidebar();

  const handleClick = () => {
    if (openMobile) setOpenMobile(false);
  };

  // Partition resources into an empty-string bucket (ungrouped) and named buckets.
  const resourceNames = Object.keys(resources).filter(
    (name) => resources[name].hasList,
  );
  const grouped = resourceNames.reduce<Record<string, string[]>>(
    (acc, name) => {
      const group: string = resources[name].options?.group ?? "";
      (acc[group] ??= []).push(name);
      return acc;
    },
    {},
  );

  const ungrouped = grouped[""] ?? [];
  const namedGroups = Object.entries(grouped).filter(([key]) => key !== "");

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link to="/">
                <Shell className="!size-5" />
                <span className="text-base font-semibold">Acme Inc.</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Dashboard + ungrouped resources */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {hasDashboard ? (
                <DashboardMenuItem onClick={handleClick} />
              ) : null}
              {ungrouped.map((name) => (
                <ResourceMenuItem
                  key={name}
                  name={name}
                  onClick={handleClick}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Named groups */}
        {namedGroups.map(([groupLabel, names]) => (
          <SidebarGroup key={groupLabel}>
            <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {names.map((name) => (
                  <ResourceMenuItem
                    key={name}
                    name={name}
                    onClick={handleClick}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter />
    </Sidebar>
  );
}

/**
 * Menu item for the dashboard link in the sidebar.
 */
export const DashboardMenuItem = ({ onClick }: { onClick?: () => void }) => {
  const translate = useTranslate();
  const label = translate("ra.page.dashboard", { _: "Dashboard" });
  const match = useMatch({ path: "/", end: true });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={!!match}>
        <Link to="/" onClick={onClick}>
          <House />
          {label}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

/**
 * Menu item for a resource link in the sidebar.
 */
export const ResourceMenuItem = ({
  name,
  onClick,
}: {
  name: string;
  onClick?: () => void;
}) => {
  const { canAccess, isPending } = useCanAccess({
    resource: name,
    action: "list",
  });
  const resources = useResourceDefinitions();
  const getResourceLabel = useGetResourceLabel();
  const createPath = useCreatePath();
  const to = createPath({ resource: name, type: "list" });
  const match = useMatch({ path: to, end: false });

  if (isPending) return <Skeleton className="h-8 w-full" />;
  if (!resources || !resources[name] || !canAccess) return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={!!match}>
        <Link to={to} state={{ _scrollToTop: true }} onClick={onClick}>
          {resources[name].icon ? (
            createElement(resources[name].icon)
          ) : (
            <List />
          )}
          {getResourceLabel(name, 2)}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};
