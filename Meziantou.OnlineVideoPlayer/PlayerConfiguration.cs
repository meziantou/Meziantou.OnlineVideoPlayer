using System.Diagnostics.CodeAnalysis;

namespace Meziantou.OnlineVideoPlayer;

[SuppressMessage("", "CA1812", Justification = "Used by configuration")]
internal sealed class PlayerConfiguration
{
    public required string RootFolderReadOnly { get; set; }
    public required string RootFolderReadWrite { get; set; }
    public required string[] ProbePaths { get; set; }

    public string GetShortPath(string value)
    {
        foreach (var probe in ProbePaths)
        {
            if (value.Length > probe.Length && value[probe.Length] == '/' && value.StartsWith(probe, StringComparison.Ordinal))
                return value[(probe.Length + 1)..];
        }

        return value;
    }
}