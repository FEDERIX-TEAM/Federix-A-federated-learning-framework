from dataclasses import dataclass


class LayoutError(ValueError):
    pass


@dataclass(frozen=True)
class LayoutEntry:
    name: str
    source: str
    transpose: bool = False


class Layout:
    def __init__(self, entries):
        self.entries = tuple(e if isinstance(e, LayoutEntry) else LayoutEntry(*e) for e in entries)
        names = [e.name for e in self.entries]
        sources = [e.source for e in self.entries]
        if not self.entries:
            raise LayoutError("a layout needs at least one entry")
        if len(set(names)) != len(names):
            raise LayoutError("canonical names in a layout must be unique")
        if len(set(sources)) != len(sources):
            raise LayoutError("each local parameter can appear only once in a layout")

    def resolve(self, local):
        local_names = list(local)
        missing = [e.source for e in self.entries if e.source not in local]
        unmapped = [n for n in local_names if n not in {e.source for e in self.entries}]
        problems = []
        if missing:
            problems.append(f"the model has no parameters named {', '.join(missing)}; it has {', '.join(local_names)}")
        if unmapped:
            problems.append(f"these model parameters are not in the layout: {', '.join(unmapped)}")
        for e in self.entries:
            if e.source in local and e.transpose and len(local[e.source]) != 2:
                problems.append(f"{e.source} has shape {local[e.source]}; only 2-D parameters can be transposed")
        if problems:
            raise LayoutError("; ".join(problems))
        return [(e.name, e.source, e.transpose) for e in self.entries]
