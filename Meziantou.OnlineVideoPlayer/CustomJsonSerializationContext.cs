using System.Text.Json.Serialization;

namespace Meziantou.OnlineVideoPlayer;

[JsonSerializable(typeof(IEnumerable<string>))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(string))]
internal sealed partial class CustomJsonSerializationContext : JsonSerializerContext;
