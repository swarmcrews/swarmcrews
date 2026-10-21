import { useRegistrationOpen } from "./project-library/use-registration-open.ts";
import { Brand } from "./components/Brand.tsx";
import { LibraryWorkspace } from "./project-library/LibraryWorkspace.tsx";
import { ProjectRegistration } from "./project-library/ProjectRegistration.tsx";
import { LibraryNotice } from "./project-library/LibraryNotice.tsx";
import { rememberDestination } from "./project-library/model.ts";
import { ProjectsTutorial } from "./ProjectsTutorial.tsx";
import "./project-list.css";
interface ProjectListProps { onOpenProject: (id: string, projectPath: string, acknowledgement?: string) => void }
export function ProjectList({ onOpenProject }: ProjectListProps) {
  const registration = useRegistrationOpen(onOpenProject);
  return <main className="project-list-page"><div className="project-list-shell">
    <header className="project-list-header"><Brand className="project-list-brand" /></header>
    {registration.notice && <LibraryNotice tone="warning" alert onDismiss={registration.dismiss}>{registration.notice}</LibraryNotice>}
    <LibraryWorkspace onOpen={(project, destination) => { rememberDestination(project.id, destination); onOpenProject(project.id, project.path); }} actions={empty => empty ? null : <ProjectsTutorial />} registration={empty => <>{empty && <ProjectsTutorial prominent />}<ProjectRegistration empty={empty} onOpenProject={registration.open} /></>} />
  </div></main>;
}
