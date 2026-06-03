import Nav from "./components/nav";
import Workspace from "./components/workspace";

export default function Home() {
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <Nav />
      <Workspace />
    </div>
  );
}
